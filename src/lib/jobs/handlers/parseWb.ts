import * as XLSX from 'xlsx';
import { loadFile } from '@/src/lib/ingestion/storage';
import type { Job } from '@/src/db/repositories/jobs';
import { findImportById, updateImport } from '@/src/db/repositories/imports';
import {
  createTransactions,
  type NewCanonicalTransaction,
} from '@/src/db/repositories/canonical-transactions';
import {
  createParsingErrors,
  type NewParsingError,
} from '@/src/db/repositories/parsing-errors';
import { normalizeDate } from '@/src/lib/parsing/normalize/dates';
import { normalizeAmount } from '@/src/lib/parsing/normalize/amounts';
import { normalizeText } from '@/src/lib/parsing/normalize/text';
import { sha256 } from '@/src/lib/ingestion/hash';

const PARSER_VERSION = 'wb_v1';
const ROW_LIMIT = 50_000;

// ── Telegram notification helper ─────────────────────────────────────────────

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
    // notification failure must not fail the job
  }
}

// ── File loading ──────────────────────────────────────────────────────────────

async function loadFileBuffer(storagePath: string): Promise<Buffer> {
  // storagePath format: "imports/{userId}/{hash}.xlsx"
  return loadFile(storagePath);
}

// ── Header detection ─────────────────────────────────────────────────────────

// Priority order matters. The real WB realization report has ~81 columns and
// several "сумма…" columns. The payout column we must reconcile against is
// "К перечислению Продавцу за реализованный товар" — but a naive "сумма" match
// hits "Общая сумма штрафов" first. So we match the most specific payout/date
// labels first and only fall back to generic ones.
const DATE_PRIORITY = ['дата продажи', 'дата операции', 'дата заказа', 'дата', 'date'];
const AMOUNT_PRIORITY = [
  'к перечислению продавцу за реализованный товар',
  'к перечислению продавцу',
  'к перечислению',
  'к выплате',
  'сумма к выплате',
];

function pickByPriority(lower: string[], priorities: string[]): number {
  for (const kw of priorities) {
    const idx = lower.findIndex((h) => h.includes(kw));
    if (idx !== -1) return idx;
  }
  return -1;
}

interface ColumnMap {
  dateCol: number;
  amountCol: number;
  referenceCol: number | null;
  descriptionCol: number | null;
  counterpartyCol: number | null;
}

function detectColumns(headers: unknown[]): ColumnMap {
  const lower = headers.map((h) => normalizeText(h));

  const dateCol = pickByPriority(lower, DATE_PRIORITY);
  const amountCol = pickByPriority(lower, AMOUNT_PRIORITY);

  if (dateCol === -1 || amountCol === -1) {
    throw new Error(
      `Required columns not found. Headers: ${lower.join(', ')}`,
    );
  }

  const referenceCol = lower.findIndex(
    (h) => h.includes('номер поставки') || h.includes('srid') || h.includes('номер'),
  );
  const descriptionCol = lower.findIndex(
    (h) =>
      h.includes('обоснование') || h.includes('назначение') || h.includes('описание'),
  );
  const counterpartyCol = lower.findIndex(
    (h) => h.includes('партн') || h.includes('контрагент') || h.includes('получатель'),
  );

  return {
    dateCol,
    amountCol,
    referenceCol: referenceCol === -1 ? null : referenceCol,
    descriptionCol: descriptionCol === -1 ? null : descriptionCol,
    counterpartyCol: counterpartyCol === -1 ? null : counterpartyCol,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleParseWb(job: Job): Promise<void> {
  const importId = (job.payload as Record<string, string>)?.import_id ?? job.entity_id;
  if (!importId) throw new Error('Missing import_id in job payload');

  const imp = await findImportById(importId);
  if (!imp) throw new Error(`Import not found: ${importId}`);

  // Idempotency: skip if already terminal
  if (imp.status === 'COMPLETED' || imp.status === 'FAILED') return;

  // Obtain telegram_id for notification (via users repository inline)
  const { findUserById } = await import('@/src/db/repositories/users');
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
      await notifyUser(user.telegram_id, '❌ Не удалось прочитать файл отчёта WB.');
    }
    return;
  }

  // Parse XLSX
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch (err) {
    const reason = `XLSX parse failed: ${err instanceof Error ? err.message : String(err)}`;
    await updateImport(importId, { status: 'FAILED', failure_reason: reason });
    if (user?.telegram_id) {
      await notifyUser(user.telegram_id, '❌ Не удалось распознать файл отчёта WB. Пришлите корректный XLSX.');
    }
    return;
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    await updateImport(importId, {
      status: 'FAILED',
      failure_reason: 'Empty workbook: no sheets found',
    });
    if (user?.telegram_id) {
      await notifyUser(user.telegram_id, '❌ Файл WB пуст. Пришлите корректный отчёт.');
    }
    return;
  }

  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
  });

  // Skip fully-empty leading rows to find header
  let headerRowIdx = 0;
  while (
    headerRowIdx < rawRows.length &&
    rawRows[headerRowIdx].every((c) => c === null || c === '')
  ) {
    headerRowIdx++;
  }

  if (headerRowIdx >= rawRows.length) {
    await updateImport(importId, {
      status: 'FAILED',
      failure_reason: 'No data rows found',
    });
    if (user?.telegram_id) {
      await notifyUser(user.telegram_id, '❌ Файл WB не содержит данных.');
    }
    return;
  }

  const headerRow = rawRows[headerRowIdx] as unknown[];
  let colMap: ColumnMap;
  try {
    colMap = detectColumns(headerRow);
  } catch (err) {
    const reason = `Header detection failed: ${err instanceof Error ? err.message : String(err)}`;
    await updateImport(importId, { status: 'FAILED', failure_reason: reason });
    if (user?.telegram_id) {
      await notifyUser(user.telegram_id, '❌ Не удалось определить структуру отчёта WB.');
    }
    return;
  }

  const dataRows = rawRows.slice(headerRowIdx + 1).filter(
    (r) => r.some((c) => c !== null && c !== ''),
  );

  if (dataRows.length === 0) {
    await updateImport(importId, {
      status: 'FAILED',
      failure_reason: 'No data rows after header',
    });
    if (user?.telegram_id) {
      await notifyUser(user.telegram_id, '❌ Отчёт WB не содержит строк с данными.');
    }
    return;
  }

  if (dataRows.length > ROW_LIMIT) {
    await updateImport(importId, {
      status: 'FAILED',
      failure_reason: 'ROW_LIMIT_EXCEEDED',
    });
    if (user?.telegram_id) {
      await notifyUser(
        user.telegram_id,
        `❌ Файл WB содержит слишком много строк (${dataRows.length}). Максимум ${ROW_LIMIT}.`,
      );
    }
    return;
  }

  await updateImport(importId, { status: 'PARSING' });

  const transactions: NewCanonicalTransaction[] = [];
  const errors: NewParsingError[] = [];
  const successDates: Date[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNumber = i + 1; // 1-based, relative to data start

    const rawDate = row[colMap.dateCol];
    const rawAmount = row[colMap.amountCol];

    // Build a short raw fragment for error logging (≤200 chars)
    const rawFragment = JSON.stringify(row).slice(0, 200);

    let txDate: Date;
    let amountKopeks: bigint;

    try {
      txDate = normalizeDate(rawDate);
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

    try {
      amountKopeks = normalizeAmount(rawAmount);
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

    // Skip rows with a zero payout (returns, logistics-only, corrections,
    // header/total artefacts). canonical_transactions has CHECK
    // amount_kopeks != 0 — inserting a zero would throw and fail the batch.
    if (amountKopeks === BigInt(0)) continue;

    const reference =
      colMap.referenceCol !== null
        ? normalizeText(row[colMap.referenceCol])
        : null;
    const description =
      colMap.descriptionCol !== null
        ? normalizeText(row[colMap.descriptionCol])
        : null;
    const counterparty =
      colMap.counterpartyCol !== null
        ? normalizeText(row[colMap.counterpartyCol])
        : null;

    // Stable row hash
    const hashInput = Buffer.from(
      JSON.stringify({
        importId,
        rowNumber,
        txDate: txDate.toISOString(),
        amountKopeks: String(amountKopeks),
        reference,
        description,
      }),
    );
    const rowHash = sha256(hashInput);

    // Limit raw_payload size
    const rawPayload = JSON.parse(
      JSON.stringify(row).slice(0, 4000),
    ) as unknown;

    transactions.push({
      import_id: importId,
      source_type: 'WB',
      row_number: rowNumber,
      transaction_date: txDate,
      amount_kopeks: amountKopeks,
      currency: 'RUB',
      direction: 'IN',
      reference,
      description,
      counterparty,
      row_hash: rowHash,
      raw_payload: rawPayload,
    });

    successDates.push(txDate);
  }

  // Batch-insert in chunks to avoid huge single queries
  const CHUNK = 500;
  for (let i = 0; i < transactions.length; i += CHUNK) {
    await createTransactions(transactions.slice(i, i + CHUNK));
  }
  await createParsingErrors(errors);

  const totalRows = dataRows.length;
  const successRows = transactions.length;
  const errorCount = errors.length;
  const parseSuccessRate =
    totalRows > 0 ? ((successRows / totalRows) * 100).toFixed(2) : '0.00';

  let qualityStatus: 'HIGH_CONFIDENCE' | 'LOW_CONFIDENCE' | 'MANUAL_REVIEW' =
    'HIGH_CONFIDENCE';
  if (parseFloat(parseSuccessRate) < 70) {
    qualityStatus = 'MANUAL_REVIEW';
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

  // Notify user
  if (user?.telegram_id) {
    const text = `✅ Отчёт WB обработан. Загружено строк: ${successRows}, ошибок: ${errorCount}. Теперь можно загрузить выписку банка.`;
    await notifyUser(user.telegram_id, text);

    if (qualityStatus === 'MANUAL_REVIEW') {
      await notifyUser(
        user.telegram_id,
        `⚠️ Файл обработан, но значительная часть строк не распознана (ошибок: ${errorCount}). Результаты сверки могут быть неполными. Мы проверим формат вашей выписки.`,
      );
    }
  }
}
