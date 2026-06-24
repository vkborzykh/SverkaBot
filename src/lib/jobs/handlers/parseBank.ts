import type { Job } from '@/src/db/repositories/jobs';
import { loadFile } from '@/src/lib/ingestion/storage';
import { findImportById, updateImport, findImportsByUserId } from '@/src/db/repositories/imports';
import { findUserById } from '@/src/db/repositories/users';
import {
  createTransactions,
  type NewCanonicalTransaction,
} from '@/src/db/repositories/canonical-transactions';
import {
  createParsingErrors,
  type NewParsingError,
} from '@/src/db/repositories/parsing-errors';
import {
  findProfileById,
  updateProfileStats,
} from '@/src/db/repositories/statement-profiles';
import {
  detectHeaderAndColumns,
  type HeaderDetectionResult,
  type ColumnMapping,
} from '@/src/lib/parsing/headerDetection';
import { resolveProfile } from '@/src/lib/profiles/resolve';
import { createDraftProfile } from '@/src/lib/profiles/draft';
import { normalizeDate } from '@/src/lib/parsing/normalize/dates';
import { normalizeAmount } from '@/src/lib/parsing/normalize/amounts';
import { normalizeText } from '@/src/lib/parsing/normalize/text';
import { sha256 } from '@/src/lib/ingestion/hash';
import { getSetting } from '@/src/lib/settings/settings';
import { enqueue } from '@/src/lib/jobs/queue';

const PARSER_VERSION = 'bank_v1';
const ROW_LIMIT = 50_000;
const INSERT_CHUNK = 2000;

async function notifyUser(telegramId: bigint, text: string): Promise<void> {
  console.log(`[parseBank] notifyUser called for ${telegramId}, text length: ${text.length}`);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[parseBank] TELEGRAM_BOT_TOKEN is missing');
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = { chat_id: String(telegramId), text };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const responseText = await res.text();
    console.log(`[parseBank] Telegram response: ${res.status}`);
    if (!res.ok) {
      console.error(`[parseBank] Non-ok response: ${res.status} ${responseText}`);
    }
  } catch (err) {
    console.error('[parseBank] Error sending message:', err);
  }
}

async function loadFileBuffer(storagePath: string): Promise<Buffer> {
  return loadFile(storagePath);
}

function extractRows(allRows: unknown[][], headerRowIndex: number): { headerRow: unknown[]; dataRows: unknown[][] } {
  const headerRow = allRows[headerRowIndex] ?? [];
  const dataRows = allRows.slice(headerRowIndex + 1).filter((r) => r.some((c) => c !== null && c !== ''));
  return { headerRow, dataRows };
}

function resolveColIndex(key: string | number | undefined, headerRow: unknown[]): number | null {
  if (key === undefined || key === null) return null;
  if (typeof key === 'number') return key;
  const lower = key.toLowerCase();
  const idx = headerRow.findIndex((h) => typeof h === 'string' && h.toLowerCase().includes(lower));
  return idx >= 0 ? idx : null;
}

interface ResolvedCols {
  dateIdx: number;
  amountIdx: number | null;
  outIdx: number | null;
  inIdx: number | null;
  descIdx: number | null;
  cpIdx: number | null;
  refIdx: number | null;
}

function resolveColumns(mapping: ColumnMapping, headerRow: unknown[]): ResolvedCols {
  const dateIdx = resolveColIndex(mapping.dateColumn, headerRow);
  if (dateIdx === null) throw new Error('Cannot resolve date column');
  const amountIdx = resolveColIndex(mapping.amountColumn, headerRow);
  const descIdx = resolveColIndex(mapping.descriptionColumn, headerRow);
  const cpIdx = resolveColIndex(mapping.counterpartyColumn, headerRow);
  const refIdx = resolveColIndex(mapping.referenceColumn, headerRow);
  const lowerHeaders = headerRow.map((h) => typeof h === 'string' ? h.toLowerCase() : '');
  const outKws = ['дебет', 'списание', 'расход', 'debit', 'withdrawal'];
  const inKws = ['кредит', 'поступление', 'приход', 'credit', 'deposit'];
  const outIdx = lowerHeaders.findIndex((h) => outKws.some((k) => h.includes(k)));
  const inIdx = lowerHeaders.findIndex((h) => inKws.some((k) => h.includes(k)));
  const hasSplit = outIdx >= 0 && inIdx >= 0 && outIdx !== inIdx;
  return { dateIdx, amountIdx: hasSplit ? null : amountIdx, outIdx: hasSplit ? outIdx : null, inIdx: hasSplit ? inIdx : null, descIdx, cpIdx, refIdx };
}

function extractSplitAmount(row: unknown[], outIdx: number, inIdx: number): { amount: bigint; direction: 'IN' | 'OUT' } | null {
  const tryAmt = (v: unknown): bigint | null => {
    if (v === null || v === undefined || v === '') return null;
    try { const n = normalizeAmount(v); return n !== BigInt(0) ? n : null; } catch { return null; }
  };
  const outAmt = tryAmt(row[outIdx]);
  if (outAmt !== null) return { amount: outAmt < BigInt(0) ? -outAmt : outAmt, direction: 'OUT' };
  const inAmt = tryAmt(row[inIdx]);
  if (inAmt !== null) return { amount: inAmt < BigInt(0) ? -inAmt : inAmt, direction: 'IN' };
  return null;
}

function parseXlsxRaw(buffer: Buffer): unknown[][] {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
}

function parseCsvRaw(buffer: Buffer): unknown[][] {
  const Papa = require('papaparse');
  const iconv = require('iconv-lite');
  const tryParse = (enc: string): unknown[][] => {
    try {
      const str = iconv.decode(buffer, enc);
      const r = Papa.parse<string[]>(str, { header: false, skipEmptyLines: false, dynamicTyping: false });
      return r.data as unknown[][];
    } catch { return []; }
  };
  const utf8 = tryParse('utf-8');
  const win = tryParse('windows-1251');
  const cyrCount = (rows: unknown[][]) => rows.slice(0, 4).flat().filter((c) => typeof c === 'string' && /[а-яА-ЯёЁ]/.test(c)).length;
  return cyrCount(win) > cyrCount(utf8) ? win : utf8;
}

export async function handleParseBank(job: Job): Promise<void> {
  console.time('[parseBank] total');
  const importId = (job.payload as Record<string, string>)?.import_id ?? job.entity_id;
  if (!importId) throw new Error('Missing import_id in job payload');

  const imp = await findImportById(importId);
  if (!imp) throw new Error(`Import not found: ${importId}`);
  if (imp.status === 'COMPLETED' || imp.status === 'FAILED') return;

  const user = await findUserById(imp.user_id);
  console.log(`[parseBank] User found: ${user?.id}, telegram_id: ${user?.telegram_id}`);

  await updateImport(importId, { status: 'ANALYZING' });

  console.time('[parseBank] loadFile');
  let buffer: Buffer;
  try {
    buffer = await loadFileBuffer(imp.storage_path!);
  } catch (err) {
    const reason = `File not accessible: ${err instanceof Error ? err.message : String(err)}`;
    await updateImport(importId, { status: 'FAILED', failure_reason: reason });
    if (user?.telegram_id) {
      notifyUser(user.telegram_id, '❌ Не удалось прочитать файл выписки.').catch(console.error);
    }
    return;
  }
  console.timeEnd('[parseBank] loadFile');

  const ext = (imp.original_filename ?? imp.storage_path ?? '').toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';

  console.time('[parseBank] detectHeaderAndColumns');
  let detection: HeaderDetectionResult | null;
  try {
    detection = await detectHeaderAndColumns(buffer, ext as 'csv' | 'xlsx');
  } catch (err) {
    const reason = `Header detection error: ${err instanceof Error ? err.message : String(err)}`;
    await updateImport(importId, { status: 'FAILED', failure_reason: reason });
    if (user?.telegram_id) {
      notifyUser(user.telegram_id, '❌ Не удалось распознать выписку. Попробуйте другой файл или другой формат.').catch(console.error);
    }
    return;
  }
  console.timeEnd('[parseBank] detectHeaderAndColumns');

  if (!detection) {
    await updateImport(importId, { status: 'FAILED', failure_reason: 'NO_HEADER_DETECTED' });
    if (user?.telegram_id) {
      notifyUser(user.telegram_id, '❌ Не удалось распознать выписку. Попробуйте другой файл или другой формат.').catch(console.error);
    }
    return;
  }

  console.time('[parseBank] resolveProfile');
  const resolveResult = await resolveProfile(detection, detection.signature, imp.user_id);
  console.timeEnd('[parseBank] resolveProfile');

  let activeProfileId: string;
  let profileConfidence: number;
  let profileStatus: 'MATCHED' | 'DRAFT';
  let profileDisplayName = 'Черновик: неизвестный банк';

  if (resolveResult.status === 'MATCHED' && resolveResult.profileId) {
    activeProfileId = resolveResult.profileId;
    profileConfidence = resolveResult.confidence;
    profileStatus = 'MATCHED';
    const profile = await findProfileById(activeProfileId);
    profileDisplayName = profile?.display_name ?? 'Известный банк';
  } else {
    activeProfileId = await createDraftProfile(detection, detection.signature, imp.user_id);
    profileConfidence = detection.confidence * 0.5;
    profileStatus = 'DRAFT';
  }

  let effectiveMapping: ColumnMapping = detection.columnMapping;
  if (profileStatus === 'MATCHED') {
    const profile = await findProfileById(activeProfileId);
    if (profile?.column_mapping) {
      effectiveMapping = profile.column_mapping as unknown as ColumnMapping;
    }
  }

  await updateImport(importId, {
    status: 'PARSING',
    profile_id: activeProfileId,
    profile_status: profileStatus,
    profile_confidence: String(profileConfidence.toFixed(4)),
  });

  console.time('[parseBank] parseRawRows');
  const rawRows = ext === 'csv' ? parseCsvRaw(buffer) : parseXlsxRaw(buffer);
  const { headerRow, dataRows } = extractRows(rawRows, detection.headerRowIndex);
  console.timeEnd('[parseBank] parseRawRows');

  if (dataRows.length === 0) {
    await updateImport(importId, { status: 'FAILED', failure_reason: 'No data rows after header' });
    if (user?.telegram_id) {
      notifyUser(user.telegram_id, '❌ Выписка не содержит строк с данными.').catch(console.error);
    }
    return;
  }
  if (dataRows.length > ROW_LIMIT) {
    await updateImport(importId, { status: 'FAILED', failure_reason: 'ROW_LIMIT_EXCEEDED' });
    if (user?.telegram_id) {
      notifyUser(user.telegram_id, `❌ Файл выписки содержит слишком много строк (${dataRows.length}). Максимум ${ROW_LIMIT}.`).catch(console.error);
    }
    return;
  }

  let cols: ResolvedCols;
  try {
    cols = resolveColumns(effectiveMapping, headerRow);
  } catch {
    try {
      cols = resolveColumns(detection.columnMapping, headerRow);
    } catch (err2) {
      const reason = `Column resolution failed: ${err2 instanceof Error ? err2.message : String(err2)}`;
      await updateImport(importId, { status: 'FAILED', failure_reason: reason });
      if (user?.telegram_id) {
        notifyUser(user.telegram_id, '❌ Не удалось распознать выписку. Попробуйте другой файл или другой формат.').catch(console.error);
      }
      return;
    }
  }

  console.time('[parseBank] processRows');
  const transactions: NewCanonicalTransaction[] = [];
  const errors: NewParsingError[] = [];
  const successDates: Date[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNumber = i + 1;
    const rawFragment = JSON.stringify(row).slice(0, 200);

    let txDate: Date;
    try {
      txDate = normalizeDate(row[cols.dateIdx]);
    } catch (e) {
      errors.push({ import_id: importId, row_number: rowNumber, error_code: 'INVALID_DATE', error_message: e instanceof Error ? e.message : String(e), raw_fragment: rawFragment });
      continue;
    }

    let amountKopeks: bigint;
    let direction: 'IN' | 'OUT';

    if (cols.outIdx !== null && cols.inIdx !== null) {
      const split = extractSplitAmount(row, cols.outIdx, cols.inIdx);
      if (!split) {
        errors.push({ import_id: importId, row_number: rowNumber, error_code: 'INVALID_AMOUNT', error_message: 'Both debit and credit cells are empty', raw_fragment: rawFragment });
        continue;
      }
      amountKopeks = split.amount;
      direction = split.direction;
    } else if (cols.amountIdx !== null) {
      try {
        const raw = normalizeAmount(row[cols.amountIdx]);
        if (raw < BigInt(0)) { amountKopeks = -raw; direction = 'OUT'; }
        else { amountKopeks = raw; direction = 'IN'; }
      } catch (e) {
        errors.push({ import_id: importId, row_number: rowNumber, error_code: 'INVALID_AMOUNT', error_message: e instanceof Error ? e.message : String(e), raw_fragment: rawFragment });
        continue;
      }
    } else {
      errors.push({ import_id: importId, row_number: rowNumber, error_code: 'NO_AMOUNT_COLUMN', error_message: 'No amount column could be resolved', raw_fragment: rawFragment });
      continue;
    }

    const reference = cols.refIdx !== null ? normalizeText(row[cols.refIdx]) || null : null;
    const description = cols.descIdx !== null ? normalizeText(row[cols.descIdx]) || null : null;
    const counterparty = cols.cpIdx !== null ? normalizeText(row[cols.cpIdx]) || null : null;

    const rowHash = sha256(Buffer.from(JSON.stringify({ importId, rowNumber, txDate: txDate.toISOString(), amountKopeks: String(amountKopeks), direction, reference })));

    transactions.push({
      import_id: importId,
      source_type: 'BANK',
      row_number: rowNumber,
      transaction_date: txDate,
      amount_kopeks: amountKopeks,
      currency: 'RUB',
      direction,
      reference,
      description,
      counterparty,
      row_hash: rowHash,
      raw_payload: JSON.parse(JSON.stringify(row).slice(0, 4000)) as unknown,
    });

    successDates.push(txDate);
  }
  console.timeEnd('[parseBank] processRows');

  console.time('[parseBank] insertTransactions');
  for (let i = 0; i < transactions.length; i += INSERT_CHUNK) {
    await createTransactions(transactions.slice(i, i + INSERT_CHUNK));
  }
  await createParsingErrors(errors);
  console.timeEnd('[parseBank] insertTransactions');

  const totalRows = dataRows.length;
  const successRows = transactions.length;
  const errorCount = errors.length;
  const parseSuccessRate = totalRows > 0 ? ((successRows / totalRows) * 100).toFixed(2) : '0.00';

  const lowConfThreshold = (await getSetting<number>('low_confidence_threshold')) ?? 0.6;
  const rate = parseFloat(parseSuccessRate);
  let qualityStatus: 'HIGH_CONFIDENCE' | 'LOW_CONFIDENCE' | 'MANUAL_REVIEW' = 'HIGH_CONFIDENCE';
  if (rate < 70) qualityStatus = 'MANUAL_REVIEW';
  else if (profileConfidence < lowConfThreshold || rate < 90) qualityStatus = 'LOW_CONFIDENCE';

  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  if (successDates.length > 0) {
    const sorted = successDates.sort((a, b) => a.getTime() - b.getTime());
    periodStart = sorted[0].toISOString().slice(0, 10);
    periodEnd = sorted[sorted.length - 1].toISOString().slice(0, 10);
  }

  await updateImport(importId, {
    status: 'COMPLETED',
    quality_status: qualityStatus,
    parse_success_rate: parseSuccessRate,
    error_count: errorCount,
    period_start: periodStart,
    period_end: periodEnd,
    parser_version: PARSER_VERSION,
    failure_reason: null,
  });

  updateProfileStats(activeProfileId).catch(() => {});

  // ── Уведомление и автозапуск ──
  if (user?.telegram_id) {
    try {
      const wbImports = await findImportsByUserId(user.id, { sourceType: 'WB', status: 'COMPLETED', limit: 1 });
      const hasWb = wbImports.length > 0;

      let message = '';
      if (qualityStatus === 'MANUAL_REVIEW') {
        message = `⚠️ Файл обработан, но значительная часть строк не распознана (ошибок: ${errorCount}). Результаты сверки могут быть неполными.`;
      } else if (profileStatus === 'MATCHED') {
        message = `✅ Выписка обработана. Использован профиль банка: «${profileDisplayName}». Распознано строк: ${successRows}, ошибок: ${errorCount}.`;
        if (qualityStatus === 'LOW_CONFIDENCE') {
          message += '\n\n⚠️ Выписка была распознана с низкой уверенностью. Результаты сверки могут быть неточны.';
        }
      } else {
        message = `⚠️ Выписка обработана, но структура банка новая. Создан черновик профиля. Точность распознавания может быть ниже.`;
      }

      if (hasWb) {
        message += '\n\nГотово. Теперь можно запустить сверку.';
        await notifyUser(user.telegram_id, message);

        // Автозапуск сверки
        const { startReconciliation } = await import('@/src/lib/reconciliation/startRun');
        const result = await startReconciliation({ userId: user.id, wbImportId: wbImports[0].id, bankImportId: importId });
        if (!('error' in result)) {
          await enqueue('reconcile', result.run_id, { run_id: result.run_id });
          await notifyUser(user.telegram_id, `Сверка запущена. Обычно занимает до минуты. Статус: /sync_status ${result.run_id}.`);
        } else {
          console.log('[parseBank] Auto-reconciliation failed:', result.error);
        }
      } else {
        message += '\n\nТеперь можно загрузить отчёт WB.';
        await notifyUser(user.telegram_id, message);
      }
    } catch (err) {
      console.error('[parseBank] Notification/auto-reconciliation error:', err);
    }
  }

  console.timeEnd('[parseBank] total');
}
