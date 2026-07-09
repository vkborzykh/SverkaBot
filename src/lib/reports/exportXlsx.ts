// src/lib/reports/exportXlsx.ts
import * as XLSX from 'xlsx';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findMatchesByRunId } from '@/src/db/repositories/reconciliation-matches';
import { findMatchItemsByMatchId } from '@/src/db/repositories/reconciliation-match-items';
import { findEvidenceByMatchId } from '@/src/db/repositories/reconciliation-evidence';
import { findTransactionsByImportId, type CanonicalTransaction } from '@/src/db/repositories/canonical-transactions';
import { findImportById } from '@/src/db/repositories/imports';
import { findCabinetById } from '@/src/db/repositories/wb-cabinets';
import { sha256 } from '@/src/lib/ingestion/hash';

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

function rubNum(kopeks: bigint): number {
  return Number(kopeks) / 100;
}

export async function buildXlsxForRun(runId: string): Promise<Buffer> {
  const run = await findRunById(runId);
  if (!run) throw new Error('Run not found');

  const [wbTxs, bankTxs, matches] = await Promise.all([
    findTransactionsByImportId(run.wb_import_id),
    findTransactionsByImportId(run.bank_import_id),
    findMatchesByRunId(run.id),
  ]);

  const wbImport = await findImportById(run.wb_import_id);
  let cabinetName: string | null = null;
  try {
    const cabId = (wbImport as any)?.cabinet_id;
    if (cabId) cabinetName = (await findCabinetById(cabId))?.name ?? null;
  } catch {}

  // Сводка
  let expectedKopeks = BigInt(0);
  let receivedKopeks = BigInt(0);
  let aggStatus: 'reconciled' | 'underpaid' | 'overpaid' | 'missing' = 'reconciled';
  const matchedBankTxIds = new Set<string>();
  for (const m of matches) {
    const items = await findMatchItemsByMatchId(m.id);
    const ev = await findEvidenceByMatchId(m.id);
    for (const it of items) {
      if (it.side === 'BANK') matchedBankTxIds.add(it.transaction_id);
    }
    const pen = ev?.penalties as Record<string, unknown> | undefined;
    if (pen?.strategy === 'wb_net_payout') {
      expectedKopeks = BigInt(String(pen.expected_net_kopeks ?? '0'));
      receivedKopeks = BigInt(String(pen.received_kopeks ?? '0'));
      aggStatus = (pen.status as any) ?? 'reconciled';
    }
  }

  const wbBank = bankTxs.filter(t => matchedBankTxIds.has(t.id) && t.direction !== 'OUT');
  const unmatched = wbTxs.filter(t => t.direction !== 'OUT' && !matchedBankTxIds.has(t.id));

  // Листы
  const wb = XLSX.utils.book_new();

  // Лист 1: Сводка
  const summaryData = [
    ['Период', `${fmtDate(wbImport?.period_start)} – ${fmtDate(wbImport?.period_end)}`],
    ['Ожидаемые выплаты, ₽', rubNum(expectedKopeks)],
    ['Поступило, ₽', rubNum(receivedKopeks)],
    ['Недоплата, ₽', rubNum(expectedKopeks - receivedKopeks > 0 ? expectedKopeks - receivedKopeks : BigInt(0))],
    ['Количество совпадений', wbBank.length],
    ['Количество недоплат', unmatched.length],
    ['Количество не найденных операций', bankTxs.filter(t => t.direction !== 'OUT' && !matchedBankTxIds.has(t.id)).length],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  // Простейшая диаграмма (текстовый блок, реальный chart сложен, оставим заглушку)
  XLSX.utils.sheet_add_aoa(wsSummary, [['Диаграмма не встроена (ограничение XLSX)']], { origin: 'A9' });
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Сводка');

  // Лист 2: Недоплаты
  const underpaidHeader = ['Дата WB', 'Номер выплаты', 'Ожидалось', 'Получено', 'Недоплата', 'Комментарий'];
  const underpaidData = unmatched.map(tx => [
    fmtDate(tx.transaction_date),
    tx.reference ?? '',
    rubNum(tx.amount_kopeks ?? BigInt(0)),
    0,
    rubNum(tx.amount_kopeks ?? BigInt(0)),
    'Не найдено в банке',
  ]);
  const wsUnderpaid = XLSX.utils.aoa_to_sheet([underpaidHeader, ...underpaidData]);
  XLSX.utils.book_append_sheet(wb, wsUnderpaid, 'Недоплаты');

  // Лист 3: Все выплаты
  const allHeader = ['Дата WB', 'Номер выплаты', 'Ожидалось', 'Дата банка', 'Получено', 'Разница', 'Статус'];
  const allData = wbTxs.filter(t => t.direction !== 'OUT').map(tx => {
    const bankTx = bankTxs.find(b => matchedBankTxIds.has(b.id));
    const received = bankTx ? rubNum(bankTx.amount_kopeks ?? BigInt(0)) : 0;
    const expected = rubNum(tx.amount_kopeks ?? BigInt(0));
    const diff = expected - received;
    const status = diff === 0 ? 'Совпало' : diff > 0 ? 'Недоплата' : 'Переплата';
    return [
      fmtDate(tx.transaction_date),
      tx.reference ?? '',
      expected,
      bankTx ? fmtDate(bankTx.transaction_date) : '',
      received,
      diff,
      status,
    ];
  });
  const wsAll = XLSX.utils.aoa_to_sheet([allHeader, ...allData]);
  XLSX.utils.book_append_sheet(wb, wsAll, 'Все выплаты');

  // Лист 4: Исходные данные
  const wbHeader = ['Дата', 'Тип документа', 'Номер документа', 'Сумма'];
  const wbData = wbTxs.map(tx => [
    fmtDate(tx.transaction_date),
    tx.direction === 'OUT' ? 'Удержание' : 'Продажа',
    tx.reference ?? '',
    rubNum(tx.amount_kopeks ?? BigInt(0)),
  ]);
  const wsWbData = XLSX.utils.aoa_to_sheet([wbHeader, ...wbData]);
  XLSX.utils.book_append_sheet(wb, wsWbData, 'WB');

  const bankHeader = ['Дата', 'Описание', 'Сумма'];
  const bankData = bankTxs.filter(t => t.direction !== 'OUT').map(tx => [
    fmtDate(tx.transaction_date),
    tx.description ?? '',
    rubNum(tx.amount_kopeks ?? BigInt(0)),
  ]);
  const wsBankData = XLSX.utils.aoa_to_sheet([bankHeader, ...bankData]);
  XLSX.utils.book_append_sheet(wb, wsBankData, 'Банк');

  // Лист 5: Метаданные
  const metaData = [
    ['Версия SverkaBot', 'bank_v2'],
    ['Версия алгоритма сверки', 'wb_net_payout'],
    ['Дата формирования', fmtDate(run.created_at)],
    ['Время обработки', `${run.started_at ? fmtDate(run.started_at) : ''}`],
    ['Количество строк WB', wbTxs.length],
    ['Количество строк банка', bankTxs.length],
    ['Hash отчёта', sha256(Buffer.from(runId)).slice(0, 16)],
    ['UUID сверки', runId],
  ];
  const wsMeta = XLSX.utils.aoa_to_sheet(metaData);
  XLSX.utils.book_append_sheet(wb, wsMeta, 'Метаданные');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
