import type { Job } from '@/src/db/repositories/jobs';
import { loadFile } from '@/src/lib/ingestion/storage';
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
import { resolveProfile } from '@/src/lib/profiles/resolve';
import { createDraftProfile } from '@/src/lib/profiles/draft';
import { normalizeDate } from '@/src/lib/parsing/normalize/dates';
import { parseAmountToKopeks } from '@/src/lib/parsing/normalize/amounts';
import { normalizeText } from '@/src/lib/parsing/normalize/text';
import { sha256 } from '@/src/lib/ingestion/hash';
import { getSetting } from '@/src/lib/settings/settings';
import { msg } from '@/src/lib/telegram/messages.ru';
import { bankCompletedKeyboard, replaceBankInlineKeyboard } from '@/src/lib/telegram/keyboard';
import { detectHeader } from '@/src/lib/parsing/headerDetection';
import { detectDelimiter } from '@/src/lib/ingestion/validate';

const PARSER_VERSION = 'bank_v2';
const ROW_LIMIT = 50_000;
const INSERT_CHUNK = 2000;

async function notifyUser(telegramId: bigint, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(telegramId), text }),
    });
  } catch (err) {
    console.error('[parseBank] notifyUser error:', err);
  }
}

async function sendWithKeyboard(telegramId: bigint, text: string, keyboard: any): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(telegramId),
        text,
        reply_markup: keyboard.reply_markup,
      }),
    });
  } catch (err) {
    console.error('[parseBank] sendWithKeyboard error:', err);
  }
}

async function loadFileBuffer(storagePath: string): Promise<Buffer> {
  return loadFile(storagePath);
}

function parseXlsxRaw(buffer: Buffer): string[][] {
  const XLSX = require('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  return rows.map((r) => r.map((c) => (c ?? '').toString()));
}

function parseCsvRaw(buffer: Buffer): string[][] {
  const Papa = require('papaparse');
  const iconv = require('iconv-lite');

  const tryDecode = (enc: string): string => {
    try { return iconv.decode(buffer, enc); } catch { return ''; }
  };

  const utf8Str = tryDecode('utf-8');
  const winStr = tryDecode('windows-1251');
  const hasCyrillic = /[а-яА-ЯёЁ]/.test(utf8Str);
  const text = hasCyrillic ? utf8Str : winStr;
  if (!text) return [];

  const delimiter = detectDelimiter(text);
  const parsed = Papa.parse(text, {
    delimiter,
    skipEmptyLines: false,
    dynamicTyping: false,
  });
  const rows: string[][] = (parsed.data as unknown[][]).map((r) =>
    Array.isArray(r) ? r.map((c) => (c ?? '').toString()) : [String(r ?? '')],
  );
  return rows;
}

export async function handleParseBank(job: Job): Promise<void> {
  console.time('[parseBank] total');
  const importId = (job.payload as Record<string, string>)?.import_id ?? job.entity_id;
  if (!importId) throw new Error('Missing import_id in job payload');

  const imp = await findImportById(importId);
  if (!imp) throw new Error(`Import not found: ${importId}`);
  if (imp.status === 'COMPLETED' || imp.status === 'FAILED' || imp.status === 'CANCELLED') return;

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
      sendWithKeyboard(user.telegram_id, '❌ Не удалось прочитать файл выписки.', replaceBankInlineKeyboard).catch(console.error);
    }
    return;
  }
  console.timeEnd('[parseBank] loadFile');

  const ext = (imp.original_filename ?? imp.storage_path ?? '').toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';

  console.time('[parseBank] parseRawRows');
  const rawRows = ext === 'csv' ? parseCsvRaw(buffer) : parseXlsxRaw(buffer);
  console.timeEnd('[parseBank] parseRawRows');

  if (rawRows.length === 0) {
    await updateImport(importId, { status: 'FAILED', failure_reason: 'No data rows found' });
    if (user?.telegram_id) {
      sendWithKeyboard(user.telegram_id, '❌ Выписка не содержит данных.', replaceBankInlineKeyboard).catch(console.error);
    }
    return;
  }

  console.time('[parseBank] detectHeader');
  const header = detectHeader(rawRows);
  console.timeEnd('[parseBank] detectHeader');

  if (!header.ok) {
    const reason = `Column resolution failed: cannot resolve ${header.missing.join(', ')} column`;
    await updateImport(importId, { status: 'FAILED', failure_reason: reason });
    if (user?.telegram_id) {
      sendWithKeyboard(user.telegram_id, '❌ Не удалось распознать выписку. Попробуйте другой файл или другой формат.', replaceBankInlineKeyboard).catch(console.error);
    }
    return;
  }

  const cols = header.columns;
  const dataRows = rawRows.slice(header.headerRowIndex + 1).filter((r) => r.some((c) => c !== null && c !== ''));

  // --- Профиль (сохраняем старую логику) ---
  const signature = rawRows[header.headerRowIndex]?.map((c) => c?.toString() ?? '').join('|') ?? '';
  const resolveResult = await resolveProfile({ columnMapping: {}, confidence: 0.5, dateFormat: '', amountFormat: '' as any, signature }, signature, imp.user_id);

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
    activeProfileId = await createDraftProfile({ columnMapping: {}, confidence: 0.5, dateFormat: '', amountFormat: '' as any, signature }, signature, imp.user_id);
    profileConfidence = 0.25;
    profileStatus = 'DRAFT';
  }

  await updateImport(importId, {
    status: 'PARSING',
    profile_id: activeProfileId,
    profile_status: profileStatus,
    profile_confidence: String(profileConfidence.toFixed(4)),
  });

  // --- Парсинг строк ---
  console.time('[parseBank] processRows');
  const transactions: NewCanonicalTransaction[] = [];
  const errors: NewParsingError[] = [];
  const successDates: Date[] = [];

  for (let i = 0; i < dataRows.length && i < ROW_LIMIT; i++) {
    const row = dataRows[i];
    const rowNumber = header.headerRowIndex + i + 2;
    const rawFragment = JSON.stringify(row).slice(0, 200);

    const rawDate = cols.date !== null ? row[cols.date] : null;
    if (!rawDate) {
      errors.push({ import_id: importId, row_number: rowNumber, error_code: 'NO_DATE', error_message: 'No date cell', raw_fragment: rawFragment });
      continue;
    }
    let txDate: Date;
    try {
      txDate = normalizeDate(rawDate);
    } catch (e) {
      errors.push({ import_id: importId, row_number: rowNumber, error_code: 'INVALID_DATE', error_message: e instanceof Error ? e.message : String(e), raw_fragment: rawFragment });
      continue;
    }

    let amountKopeks: bigint | null = null;
    let direction: 'IN' | 'OUT' = 'IN';
    if (cols.amount !== null) {
      amountKopeks = parseAmountToKopeks(row[cols.amount]);
      if (amountKopeks !== null) {
        direction = amountKopeks < BigInt(0) ? 'OUT' : 'IN';
        if (amountKopeks < BigInt(0)) amountKopeks = -amountKopeks;
      }
    } else if (cols.debit !== null && cols.credit !== null) {
      const debit = parseAmountToKopeks(row[cols.debit]);
      const credit = parseAmountToKopeks(row[cols.credit]);
      if (debit && debit > BigInt(0)) { amountKopeks = debit; direction = 'OUT'; }
      else if (credit && credit > BigInt(0)) { amountKopeks = credit; direction = 'IN'; }
      else if (debit && debit < BigInt(0)) { amountKopeks = -debit; direction = 'IN'; }
      else if (credit && credit < BigInt(0)) { amountKopeks = -credit; direction = 'OUT'; }
    }
    if (amountKopeks === null || amountKopeks === BigInt(0)) {
      errors.push({ import_id: importId, row_number: rowNumber, error_code: 'NO_AMOUNT', error_message: 'No amount cell', raw_fragment: rawFragment });
      continue;
    }

    const reference = cols.docNumber !== null ? normalizeText(row[cols.docNumber]) || null : null;
    const description = cols.purpose !== null ? normalizeText(row[cols.purpose]) || null : null;
    const counterparty = cols.counterparty !== null ? normalizeText(row[cols.counterparty]) || null : null;

    const rowHash = sha256(Buffer.from(JSON.stringify({ importId, rowNumber, txDate: txDate.toISOString(), amountKopeks: String(amountKopeks), direction, reference })));

    transactions.push({
      import_id: importId,
      source_type: 'BANK',
      marketplace: null,
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

  let qualityStatus: 'NORMAL' | 'LOW_CONFIDENCE' | 'MANUAL_REVIEW' = 'NORMAL';
  if (parseFloat(parseSuccessRate) < 70) qualityStatus = 'MANUAL_REVIEW';

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

  // Уведомление
  if (user?.telegram_id) {
    try {
      const sessionPayload = await import('@/src/lib/telegram/session').then(m => m.getSessionPayload(user.telegram_id!));
      const isReconciliationActive = sessionPayload && 'bank_import_id' in (sessionPayload ?? {});

      if (isReconciliationActive && periodStart && periodEnd && sessionPayload?.wb_import_id) {
        const wbImp = await findImportById(sessionPayload.wb_import_id as string);
        if (wbImp && wbImp.period_start && wbImp.period_end) {
          const { periodsCover } = await import('@/src/lib/reconciliation/startRun');
          if (!periodsCover(wbImp.period_start, wbImp.period_end, periodStart, periodEnd, 31)) {
            await sendWithKeyboard(user.telegram_id, '⚠️ Период банковской выписки не покрывает период отчёта WB. Проверьте файлы.', replaceBankInlineKeyboard);
            return;
          }
        }
      }

      if (isReconciliationActive) {
        await sendWithKeyboard(user.telegram_id, msg.uploadBankCompleted, bankCompletedKeyboard);
      } else {
        await notifyUser(user.telegram_id, msg.uploadBankCompleted);
      }
    } catch (err) {
      console.error('[parseBank] Notification error:', err);
    }
  }

  console.timeEnd('[parseBank] total');
}
