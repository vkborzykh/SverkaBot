import { readFile } from 'fs/promises';
import { join } from 'path';
import type { Job } from '@/src/db/repositories/jobs';
import { findImportById, updateImport } from '@/src/db/repositories/imports';
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

const PARSER_VERSION = 'bank_v1';
const ROW_LIMIT = 50_000;
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? '/tmp/sverkbot-uploads';

// ── Telegram notification helper ──────────────────────────────────────────────

async function notifyUser(telegramId: bigint, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(telegramId), text }),
    });
  } catch {
    // notification failures must not fail the job
  }
}

// ── File loading ──────────────────────────────────────────────────────────────

async function loadFileBuffer(storagePath: string): Promise<Buffer> {
  return readFile(join(UPLOADS_DIR, storagePath));
}

// ── Row parsing helpers ───────────────────────────────────────────────────────

function extractRows(
  allRows: unknown[][],
  headerRowIndex: number,
): { headerRow: unknown[]; dataRows: unknown[][] } {
  const headerRow = allRows[headerRowIndex] ?? [];
  const dataRows = allRows
    .slice(headerRowIndex + 1)
    .filter((r) => r.some((c) => c !== null && c !== ''));
  return { headerRow, dataRows };
}

function resolveColIndex(
  key: string | number | undefined,
  headerRow: unknown[],
): number | null {
  if (key === undefined || key === null) return null;
  if (typeof key === 'number') return key;
  const lower = key.toLowerCase();
  const idx = headerRow.findIndex(
    (h) => typeof h === 'string' && h.toLowerCase().includes(lower),
  );
  return idx >= 0 ? idx : null;
}

interface ResolvedCols {
  dateIdx: number;
  amountIdx: number | null;
  debitIdx: number | null;
  creditIdx: number | null;
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

  // Detect separate debit/credit columns in the header
  const lowerHeaders = headerRow.map((h) =>
    typeof h === 'string' ? h.toLowerCase() : '',
  );
  const debitKws = ['дебет', 'debit', 'приход', 'deposit'];
  const creditKws = ['кредит', 'credit', 'расход', 'withdrawal'];

  const debitIdx = lowerHeaders.findIndex((h) => debitKws.some((k) => h.includes(k)));
  const creditIdx = lowerHeaders.findIndex((h) => creditKws.some((k) => h.includes(k)));
  const hasSplit = debitIdx >= 0 && creditIdx >= 0 && debitIdx !== creditIdx;

  return {
    dateIdx,
    amountIdx: hasSplit ? null : amountIdx,
    debitIdx: hasSplit ? debitIdx : null,
    creditIdx: hasSplit ? creditIdx : null,
    descIdx,
    cpIdx,
    refIdx,
  };
}

function extractSplitAmount(
  row: unknown[],
  debitIdx: number,
  creditIdx: number,
): { amount: bigint; direction: 'IN' | 'OUT' } | null {
  const tryAmt = (v: unknown): bigint | null => {
    if (v === null || v === undefined || v === '') return null;
    try {
      const n = normalizeAmount(v);
      return n !== BigInt(0) ? n : null;
    } catch {
      return null;
    }
  };

  const debitAmt = tryAmt(row[debitIdx]);
  if (debitAmt !== null) {
    return { amount: debitAmt < BigInt(0) ? -debitAmt : debitAmt, direction: 'IN' };
  }
  const creditAmt = tryAmt(row[creditIdx]);
  if (creditAmt !== null) {
    return { amount: creditAmt < BigInt(0) ? -creditAmt : creditAmt, direction: 'OUT' };
  }
  return null;
}

// ── Raw-row parsers ───────────────────────────────────────────────────────────

function parseXlsxRaw(buffer: Buffer): unknown[][] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const XLSX = require('xlsx') as typeof import('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
}

function parseCsvRaw(buffer: Buffer): unknown[][] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Papa = require('papaparse') as typeof import('papaparse');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const iconv = require('iconv-lite') as typeof import('iconv-lite');

  const tryParse = (enc: string): unknown[][] => {
    try {
      const str = iconv.decode(buffer, enc);
      const r = Papa.parse<string[]>(str, {
        header: false,
        skipEmptyLines: false,
        dynamicTyping: false,
      });
      return r.data as unknown[][];
    } catch {
      return [];
    }
  };

  const utf8 = tryParse('utf-8');
  const win = tryParse('windows-1251');
  const cyrCount = (rows: unknown[][]) =>
    rows
      .slice(0, 4)
      .flat()
      .filter((c) => typeof c === 'string' && /[а-яА-ЯёЁ]/.test(c)).length;

  return cyrCount(win) > cyrCount(utf8) ? win : utf8;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleParseBank(job: Job): Promise<void> {
  const importId = (job.payload as Record<string, string>)?.import_id ?? job.entity_id;
  if (!importId) throw new Error('Missing import_id in job payload');

  const imp = await findImportById(importId);
  if (!imp) throw new Error(`Import not found: ${importId}`);

  // Idempotency
  if (imp.status === 'COMPLETED' || imp.status === 'FAILED') return;

  const user = await findUserById(imp.user_id);

  await updateImport(importId, { status: 'ANALYZING' });

  // Load file
  let buffer: Buffer;
  try {
    buffer = await loadFileBuffer(imp.storage_path!);
  } catch (err) {
    const reason = `File not accessible: ${err instanceof Error ? err.message : String(err)}`;
    await updateImport(importId, { status: 'FAILED', failure_reason: reason });
    if (user?.telegram_id) {
      await notifyUser(user.telegram_id, '❌ Не удалось прочитать файл выписки.');
    }
    return;
  }

  // Detect file type
  const ext = (imp.original_filename ?? imp.storage_path ?? '').toLowerCase().endsWith('.csv')
    ? 'csv'
    : 'xlsx';

  // Run header detection
  let detection: HeaderDetectionResult | null;
  try {
    detection = await detectHeaderAndColumns(buffer, ext as 'csv' | 'xlsx');
  } catch (err) {
    const reason = `Header detection error: ${err instanceof Error ? err.message : String(err)}`;
    await updateImport(importId, { status: 'FAILED', failure_reason: reason });
    if (user?.telegram_id) {
      await notifyUser(
        user.telegram_id,
        '❌ Не удалось распознать выписку. Попробуйте другой файл или другой формат.',
      );
    }
    return;
  }

  if (!detection) {
    await updateImport(importId, { status: 'FAILED', failure_reason: 'NO_HEADER_DETECTED' });
    if (user?.telegram_id) {
      await notifyUser(
        user.telegram_id,
        '❌ Не удалось распознать выписку. Попробуйте другой файл или другой формат.',
      );
    }
    return;
  }

  // Profile resolution
  const resolveResult = await resolveProfile(detection, detection.signature, imp.user_id);

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

  // Use stored profile mapping for MATCHED, otherwise use detection
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

  // Parse raw rows
  const rawRows = ext === 'csv' ? parseCsvRaw(buffer) : parseXlsxRaw(buffer);
  const { headerRow, dataRows } = extractRows(rawRows, detection.headerRowIndex);

  if (dataRows.length === 0) {
    await updateImport(importId, {
      status: 'FAILED',
      failure_reason: 'No data rows after header',
    });
    if (user?.telegram_id) {
      await notifyUser(user.telegram_id, '❌ Выписка не содержит строк с данными.');
    }
    return;
  }

  if (dataRows.length > ROW_LIMIT) {
    await updateImport(importId, { status: 'FAILED', failure_reason: 'ROW_LIMIT_EXCEEDED' });
    if (user?.telegram_id) {
      await notifyUser(
        user.telegram_id,
        `❌ Файл выписки содержит слишком много строк (${dataRows.length}). Максимум ${ROW_LIMIT}.`,
      );
    }
    return;
  }

  // Resolve column indices
  let cols: ResolvedCols;
  try {
    cols = resolveColumns(effectiveMapping, headerRow);
  } catch {
    try {
      cols = resolveColumns(detection.columnMapping, headerRow);
    } catch (err2) {
      const reason = `Column resolution failed: ${
        err2 instanceof Error ? err2.message : String(err2)
      }`;
      await updateImport(importId, { status: 'FAILED', failure_reason: reason });
      if (user?.telegram_id) {
        await notifyUser(
          user.telegram_id,
          '❌ Не удалось распознать выписку. Попробуйте другой файл или другой формат.',
        );
      }
      return;
    }
  }

  // Parse rows
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
      errors.push({
        import_id: importId,
        row_number: rowNumber,
        error_code: 'INVALID_DATE',
        error_message: e instanceof Error ? e.message : String(e),
        raw_fragment: rawFragment,
      });
      continue;
    }

    let amountKopeks: bigint;
    let direction: 'IN' | 'OUT';

    if (cols.debitIdx !== null && cols.creditIdx !== null) {
      const split = extractSplitAmount(row, cols.debitIdx, cols.creditIdx);
      if (!split) {
        errors.push({
          import_id: importId,
          row_number: rowNumber,
          error_code: 'INVALID_AMOUNT',
          error_message: 'Both debit and credit cells are empty',
          raw_fragment: rawFragment,
        });
        continue;
      }
      amountKopeks = split.amount;
      direction = split.direction;
    } else if (cols.amountIdx !== null) {
      try {
        const raw = normalizeAmount(row[cols.amountIdx]);
        if (raw < BigInt(0)) {
          amountKopeks = -raw;
          direction = 'OUT';
        } else {
          amountKopeks = raw;
          direction = 'IN';
        }
      } catch (e) {
        errors.push({
          import_id: importId,
          row_number: rowNumber,
          error_code: 'INVALID_AMOUNT',
          error_message: e instanceof Error ? e.message : String(e),
          raw_fragment: rawFragment,
        });
        continue;
      }
    } else {
      errors.push({
        import_id: importId,
        row_number: rowNumber,
        error_code: 'NO_AMOUNT_COLUMN',
        error_message: 'No amount column could be resolved',
        raw_fragment: rawFragment,
      });
      continue;
    }

    const reference =
      cols.refIdx !== null ? normalizeText(row[cols.refIdx]) || null : null;
    const description =
      cols.descIdx !== null ? normalizeText(row[cols.descIdx]) || null : null;
    const counterparty =
      cols.cpIdx !== null ? normalizeText(row[cols.cpIdx]) || null : null;

    const rowHash = sha256(
      Buffer.from(
        JSON.stringify({
          importId,
          rowNumber,
          txDate: txDate.toISOString(),
          amountKopeks: String(amountKopeks),
          direction,
          reference,
        }),
      ),
    );

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

  // Batch insert
  const CHUNK = 500;
  for (let i = 0; i < transactions.length; i += CHUNK) {
    await createTransactions(transactions.slice(i, i + CHUNK));
  }
  await createParsingErrors(errors);

  // Compute metrics
  const totalRows = dataRows.length;
  const successRows = transactions.length;
  const errorCount = errors.length;
  const parseSuccessRate =
    totalRows > 0 ? ((successRows / totalRows) * 100).toFixed(2) : '0.00';

  const lowConfThreshold =
    (await getSetting<number>('low_confidence_threshold')) ?? 0.6;
  const rate = parseFloat(parseSuccessRate);
  let qualityStatus: 'HIGH_CONFIDENCE' | 'LOW_CONFIDENCE' | 'MANUAL_REVIEW' =
    'HIGH_CONFIDENCE';
  if (rate < 70) {
    qualityStatus = 'MANUAL_REVIEW';
  } else if (profileConfidence < lowConfThreshold || rate < 90) {
    qualityStatus = 'LOW_CONFIDENCE';
  }

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

  // Update profile stats asynchronously (fire-and-forget)
  updateProfileStats(activeProfileId).catch(() => {});

  // Notify user (User_Flow_2_3.md Flow 3 messages)
  if (user?.telegram_id) {
    if (qualityStatus === 'MANUAL_REVIEW') {
      await notifyUser(
        user.telegram_id,
        `⚠️ Файл обработан, но значительная часть строк не распознана (ошибок: ${errorCount}). Результаты сверки могут быть неполными. Мы проверим формат вашей выписки.`,
      );
    } else if (profileStatus === 'MATCHED') {
      await notifyUser(
        user.telegram_id,
        `✅ Выписка обработана. Использован профиль банка: «${profileDisplayName}». Распознано строк: ${successRows}, ошибок: ${errorCount}.`,
      );
      if (qualityStatus === 'LOW_CONFIDENCE') {
        await notifyUser(
          user.telegram_id,
          '⚠️ Выписка была распознана с низкой уверенностью. Результаты сверки могут быть неточны.',
        );
      }
    } else {
      await notifyUser(
        user.telegram_id,
        '⚠️ Выписка обработана, но структура банка новая. Создан черновик профиля. Точность распознавания может быть ниже. Рекомендуем проверить отчёт.',
      );
    }
    await notifyUser(user.telegram_id, 'Готово. Теперь можно запустить сверку.');
  }
}
