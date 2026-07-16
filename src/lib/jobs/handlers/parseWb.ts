import * as XLSX from 'xlsx';
import { loadFile } from '@/src/lib/ingestion/storage';
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
import { normalizeDate } from '@/src/lib/parsing/normalize/dates';
import { normalizeAmount } from '@/src/lib/parsing/normalize/amounts';
import { normalizeText, normalizeDisplayText } from '@/src/lib/parsing/normalize/text';
import { sha256 } from '@/src/lib/ingestion/hash';
import { msg } from '@/src/lib/telegram/messages.ru';
import { wbCompletedKeyboard, replaceWbInlineKeyboard } from '@/src/lib/telegram/keyboard';

const PARSER_VERSION = 'wb_v2';
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
    console.error('[parseWb] notifyUser error:', err);
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
    console.error('[parseWb] sendWithKeyboard error:', err);
  }
}

async function loadFileBuffer(storagePath: string): Promise<Buffer> {
  return loadFile(storagePath);
}

const DATE_PRIORITY = ['дата продажи', 'дата операции', 'дата заказа', 'дата', 'date'];
const AMOUNT_PRIORITY = [
  'к перечислению продавцу за реализованный товар',
  'к перечислению продавцу',
  'к перечислению',
  'к выплате',
  'сумма к выплате',
];

// Приоритет колонок для классификации типа операции
const CATEGORY_PRIORITY = [
  'вид операции',
  'тип начисления',
  'наименование услуги',
  'основание',
  'тип',
  'категория',
];

// Карта якорных фраз для выделения удержаний в отдельные транзакции
// Фразы подобраны под реальный 81-колоночный отчёт WB (детализация).
// Используются якорные (длинные) совпадения, чтобы не путать колонку
// «Вознаграждение с продаж до вычета услуг поверенного» (выручка, не удержание)
// с колонкой «Вознаграждение Вайлдберриз (ВВ), без НДС» (комиссия WB).
const DEDUCTION_COLUMNS = [
  { keywords: ['услуги по доставке', 'логистик'], category: 'LOGISTICS' },
  { keywords: ['хранение'], category: 'STORAGE' },
  { keywords: ['общая сумма штрафов'], category: 'PENALTY' },
  { keywords: ['удержания'], category: 'DEDUCTION' },
  { keywords: ['вознаграждение вайлдберриз'], category: 'COMMISSION' },
  { keywords: ['реклам', 'продвижен', 'маркетинг', 'advert'], category: 'MARKETING' },
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
  categoryCol: number | null;
  referenceCol: number | null;
  descriptionCol: number | null;
  counterpartyCol: number | null;
  deductionCols: { index: number; category: string }[];
}

function detectColumns(headers: unknown[]): ColumnMap {
  const lower = headers.map((h) => normalizeText(h));
  const dateCol = pickByPriority(lower, DATE_PRIORITY);
  const amountCol = pickByPriority(lower, AMOUNT_PRIORITY);
  if (dateCol === -1 || amountCol === -1) {
    throw new Error(`Required columns not found. Headers: ${lower.join(', ')}`);
  }

  const categoryCol = pickByPriority(lower, CATEGORY_PRIORITY);
  const referenceCol = lower.findIndex(
    (h) => h.includes('номер поставки') || h.includes('srid') || h.includes('номер'),
  );
  const descriptionCol = lower.findIndex(
    (h) => h.includes('обоснование') || h.includes('назначение') || h.includes('описание'),
  );
  const counterpartyCol = lower.findIndex(
    (h) => h.includes('партн') || h.includes('контрагент') || h.includes('получатель'),
  );

  const deductionCols: { index: number; category: string }[] = [];
  for (const dc of DEDUCTION_COLUMNS) {
    for (const kw of dc.keywords) {
      const idx = lower.findIndex((h) => h.includes(kw));
      if (idx !== -1 && idx !== dateCol && idx !== amountCol) {
        deductionCols.push({ index: idx, category: dc.category });
        break;
      }
    }
  }

  return {
    dateCol,
    amountCol,
    categoryCol: categoryCol === -1 ? null : categoryCol,
    referenceCol: referenceCol === -1 ? null : referenceCol,
    descriptionCol: descriptionCol === -1 ? null : descriptionCol,
    counterpartyCol: counterpartyCol === -1 ? null : counterpartyCol,
    deductionCols,
  };
}

function classifyWbRow(cellValue: unknown, payoutDirection: 'IN' | 'OUT'): string {
  const text = normalizeText(String(cellValue ?? ''));
  if (payoutDirection === 'OUT') return 'REFUND';
  if (!text) return 'SALE';
  const lower = text.toLowerCase();
  if (['возврат', 'refund', 'отмена'].some(k => lower.includes(k))) return 'REFUND';
  if (['логистик', 'logistic', 'доставк', 'delivery'].some(k => lower.includes(k))) return 'LOGISTICS';
  if (['хранен', 'storage', 'склад'].some(k => lower.includes(k))) return 'STORAGE';
  if (['штраф', 'penalty', 'неустойк', 'fine'].some(k => lower.includes(k))) return 'PENALTY';
  if (['комисси', 'commission', 'вознагражд'].some(k => lower.includes(k))) return 'COMMISSION';
  if (['реклам', 'продвижен', 'маркетинг', 'advert'].some(k => lower.includes(k))) return 'MARKETING';
  if (['продаж', 'реализац', 'sale'].some(k => lower.includes(k))) return 'SALE';
  return 'OTHER';
}

export async function handleParseWb(job: Job): Promise<void> {
  console.time('[parseWb] total');
  const importId = (job.payload as Record<string, string>)?.import_id ?? job.entity_id;
  if (!importId) throw new Error('Missing import_id in job payload');

  const imp = await findImportById(importId);
  if (!imp) throw new Error(`Import not found: ${importId}`);
  if (imp.status === 'COMPLETED' || imp.status === 'FAILED' || imp.status === 'CANCELLED') return;

  const user = await findUserById(imp.user_id);
  console.log(`[parseWb] User found: ${user?.id}, telegram_id: ${user?.telegram_id}`);

  await updateImport(importId, { status: 'ANALYZING' });

  console.time('[parseWb] loadFile');
  let buffer: Buffer;
  try {
    buffer = await loadFileBuffer(imp.storage_path!);
  } catch (err) {
    const reason = `File not accessible: ${err instanceof Error ? err.message : String(err)}`;
    await updateImport(importId, { status: 'FAILED', failure_reason: reason });
    if (user?.telegram_id) {
      sendWithKeyboard(user.telegram_id, '❌ Не удалось прочитать файл отчёта WB.', replaceWbInlineKeyboard).catch(console.error);
    }
    return;
  }
  console.timeEnd('[parseWb] loadFile');

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  } catch (err) {
    const reason = `XLSX parse failed: ${err instanceof Error ? err.message : String(err)}`;
    await updateImport(importId, { status: 'FAILED', failure_reason: reason });
    if (user?.telegram_id) {
      sendWithKeyboard(user.telegram_id, '❌ Не удалось распознать файл отчёта WB. Пришлите корректный XLSX.', replaceWbInlineKeyboard).catch(console.error);
    }
    return;
  }

  const sheetNames = workbook.SheetNames;
  let sheetName = sheetNames[0];
  for (const name of sheetNames) {
    if (name.toLowerCase().includes('детализац')) {
      sheetName = name;
      break;
    }
  }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    await updateImport(importId, { status: 'FAILED', failure_reason: 'Empty workbook: no sheets found' });
    if (user?.telegram_id) {
      sendWithKeyboard(user.telegram_id, '❌ Файл WB пуст. Пришлите корректный отчёт.', replaceWbInlineKeyboard).catch(console.error);
    }
    return;
  }

  const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  let headerRowIdx = 0;
  while (headerRowIdx < rawRows.length && rawRows[headerRowIdx].every((c) => c === null || c === '')) {
    headerRowIdx++;
  }
  if (headerRowIdx >= rawRows.length) {
    await updateImport(importId, { status: 'FAILED', failure_reason: 'No data rows found' });
    if (user?.telegram_id) {
      sendWithKeyboard(user.telegram_id, '❌ Файл WB не содержит данных.', replaceWbInlineKeyboard).catch(console.error);
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
      sendWithKeyboard(user.telegram_id, '❌ Не удалось определить структуру отчёта WB.', replaceWbInlineKeyboard).catch(console.error);
    }
    return;
  }

  const dataRows = rawRows.slice(headerRowIdx + 1).filter((r) => r.some((c) => c !== null && c !== ''));
  if (dataRows.length === 0) {
    await updateImport(importId, { status: 'FAILED', failure_reason: 'No data rows after header' });
    if (user?.telegram_id) {
      sendWithKeyboard(user.telegram_id, '❌ Отчёт WB не содержит строк с данными.', replaceWbInlineKeyboard).catch(console.error);
    }
    return;
  }
  if (dataRows.length > ROW_LIMIT) {
    await updateImport(importId, { status: 'FAILED', failure_reason: 'ROW_LIMIT_EXCEEDED' });
    if (user?.telegram_id) {
      sendWithKeyboard(user.telegram_id, `❌ Файл WB содержит слишком много строк (${dataRows.length}). Максимум ${ROW_LIMIT}.`, replaceWbInlineKeyboard).catch(console.error);
    }
    return;
  }

  await updateImport(importId, { status: 'PARSING' });

  console.time('[parseWb] processRows');
  const transactions: NewCanonicalTransaction[] = [];
  const errors: NewParsingError[] = [];
  const successDates: Date[] = [];
  let processedRows = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNumber = i + 1;
    const rawFragment = JSON.stringify(row).slice(0, 200);
    if (row.every((c) => c === null || c === undefined || String(c).trim() === '')) continue;

    let txDate: Date;
    try {
      txDate = normalizeDate(row[colMap.dateCol]);
    } catch (e) {
      errors.push({ import_id: importId, row_number: rowNumber, error_code: 'INVALID_DATE', error_message: e instanceof Error ? e.message : String(e), raw_fragment: rawFragment });
      continue;
    }

    const components: { amount: bigint; direction: 'IN' | 'OUT'; kind: string }[] = [];
    const rawPayout = row[colMap.amountCol];
    if (rawPayout !== null && rawPayout !== undefined && String(rawPayout).trim() !== '') {
      try {
        const p = normalizeAmount(rawPayout);
        if (p !== BigInt(0)) {
          components.push({ amount: p < BigInt(0) ? -p : p, direction: p < BigInt(0) ? 'OUT' : 'IN', kind: p < BigInt(0) ? 'возврат' : 'payout' });
        }
      } catch (e) {
        errors.push({ import_id: importId, row_number: rowNumber, error_code: 'INVALID_AMOUNT', error_message: e instanceof Error ? e.message : String(e), raw_fragment: rawFragment });
        continue;
      }
    }

    // Добавляем транзакции удержаний из специализированных колонок
    for (const dcol of colMap.deductionCols) {
      const rawVal = row[dcol.index];
      if (rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== '') {
        try {
          const amt = normalizeAmount(rawVal);
          // Удержания обычно положительные в отчёте, но мы трактуем их как OUT
          if (amt > BigInt(0)) {
            components.push({ amount: amt, direction: 'OUT', kind: dcol.category.toLowerCase() });
          }
        } catch (e) {
          // Не критично, просто пропускаем
        }
      }
    }

    if (components.length === 0) {
      processedRows++;
      continue;
    }

    const reference = colMap.referenceCol !== null ? normalizeDisplayText(row[colMap.referenceCol]) : null;
    const description = colMap.descriptionCol !== null ? normalizeDisplayText(row[colMap.descriptionCol]) : null;
    const counterparty = colMap.counterpartyCol !== null ? normalizeDisplayText(row[colMap.counterpartyCol]) : null;
    const rawPayload = JSON.parse(JSON.stringify(row).slice(0, 4000)) as unknown;

    // Определяем базовую категорию из специальной колонки, если есть
    const categoryFromCol = colMap.categoryCol !== null
      ? classifyWbRow(row[colMap.categoryCol], 'IN')
      : undefined;

    for (const c of components) {
      let category = categoryFromCol;
      if (!category) {
        category = classifyWbRow(null, c.direction);
      }
      // Уточняем категорию для удержаний, если есть kind
      if (c.kind && c.direction === 'OUT') {
        category = c.kind.toUpperCase(); // kind уже содержит категорию из deductionCols
      } else if (c.direction === 'OUT' && category !== 'REFUND') {
        category = 'DEDUCTION'; // fallback
      }

      const rowHash = sha256(Buffer.from(JSON.stringify({ importId, rowNumber, kind: c.kind, direction: c.direction, txDate: txDate.toISOString(), amount: String(c.amount) })));
      transactions.push({
        import_id: importId,
        source_type: 'WB',
        marketplace: 'WB',
        row_number: rowNumber,
        transaction_date: txDate,
        amount_kopeks: c.amount,
        currency: 'RUB',
        direction: c.direction,
        reference,
        description: c.kind === 'payout' || c.kind === 'возврат' ? description : `${description ?? ''} [${c.kind}]`.trim(),
        counterparty,
        category,
        row_hash: rowHash,
        raw_payload: c.kind === 'payout' ? rawPayload : null,
      });
    }
    processedRows++;
    successDates.push(txDate);
  }
  console.timeEnd('[parseWb] processRows');

  console.time('[parseWb] insertTransactions');
  for (let i = 0; i < transactions.length; i += INSERT_CHUNK) {
    await createTransactions(transactions.slice(i, i + INSERT_CHUNK));
  }
  await createParsingErrors(errors);
  console.timeEnd('[parseWb] insertTransactions');

  const totalRows = dataRows.length;
  const successRows = processedRows;
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

  // ── Уведомление (без автозапуска, с проверкой периодов) ──
  if (user?.telegram_id) {
    try {
      const sessionPayload = await import('@/src/lib/telegram/session').then(m => m.getSessionPayload(user.telegram_id!));
      const isReconciliationActive = sessionPayload && 'wb_import_id' in (sessionPayload ?? {});

      if (isReconciliationActive && periodStart && periodEnd && sessionPayload?.bank_import_id) {
        const bankImp = await findImportById(sessionPayload.bank_import_id as string);
        if (bankImp && bankImp.period_start && bankImp.period_end) {
          const { periodsCover } = await import('@/src/lib/reconciliation/startRun');
          if (!periodsCover(periodStart, periodEnd, bankImp.period_start, bankImp.period_end, 31)) {
            await sendWithKeyboard(user.telegram_id, '⚠️ Период банковской выписки не покрывает период отчёта WB. Проверьте файлы.', replaceWbInlineKeyboard);
            return;
          }
        }
      }

      if (isReconciliationActive) {
        await sendWithKeyboard(user.telegram_id, msg.uploadWbCompleted, wbCompletedKeyboard);
      } else {
        await notifyUser(user.telegram_id, msg.uploadWbCompleted);
      }
    } catch (err) {
      console.error('[parseWb] Notification error:', err);
    }
  }

  console.timeEnd('[parseWb] total');
}
