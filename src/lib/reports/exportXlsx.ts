// src/lib/reports/exportXlsx.ts
//
// XLSX-выгрузка: "Сводка" (агрегат по run) + ПОЛНЫЕ сырые данные WB и банка
// каждые на своём листе.
//
// Что убрано по сравнению с прошлой версией и почему:
// - Листы "Недоплаты" и "Все выплаты" удалены полностью. Они пытались
//   показать попарное соответствие WB-строка <-> банковская операция,
//   которого нет в движке сверки (сравнивается только агрегат за весь
//   отчёт). Патчить их точечно нельзя — сама идея строки в проекте неверна:
//     * "Недоплаты" фильтровала wbTxs по membership в Set банковских id
//       (matchedBankTxIds), из-за чего условие было истинным всегда —
//       на листе оказывались вообще все WB-транзакции.
//     * "Все выплаты" делала bankTxs.find(...) один раз вне цикла по tx,
//       поэтому одна и та же (первая попавшаяся) банковская операция
//       подставлялась во все строки.
// - Вместо них — лист "Банк — исходные данные" с честным флагом
//   "Отнесено к WB" (да/нет) на каждую банковскую строку. Это не выдуманное
//   соответствие конкретной WB-строке, а реальный факт, который движок
//   действительно вычисляет: было ли поступление учтено как WB-платёж.
// - Денежные суммы теперь через formatRub() (целочисленная арифметика над
//   копейками) вместо rubNum() = Number(kopeks) / 100, которая могла давать
//   ошибки округления с плавающей точкой.
// - "Метаданные": хэш теперь считается от РЕАЛЬНОГО содержимого (сумм и
//   хэшей строк), а не от runId — раньше sha256(Buffer.from(runId)) не
//   проверял вообще ничего, так как runId и так известен получателю.
// - Убрана текстовая заглушка про диаграмму на листе "Сводка".

import * as XLSX from 'xlsx';
import { getRunAggregates, formatRub, fmtDate } from './runAggregates';

export async function buildXlsxForRun(runId: string): Promise<Buffer> {
  const agg = await getRunAggregates(runId);

  const wb = XLSX.utils.book_new();

  // Лист 1: Сводка
  const summaryData = [
    ['ID сверки', agg.runId],
    ['Дата сверки', fmtDate(agg.createdAt)],
    ['Кабинет WB', agg.cabinetName ?? '—'],
    ['Период отчёта WB', `${agg.periodFrom} – ${agg.periodTo}`],
    ['Ожидалось, руб.', formatRub(agg.expectedKopeks)],
    ['Получено, руб.', formatRub(agg.receivedKopeks)],
    ['Разница, руб.', formatRub(agg.diffKopeks)],
    ['Статус', agg.statusLabel],
    ['Строк в WB-отчёте', agg.wbTxs.length],
    ['Банковских поступлений, отнесённых к WB', agg.wbBankCredits.length],
    ['Всего банковских операций в выписке', agg.bankTxs.length],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Сводка');

  // Лист 2: WB — исходные данные (полностью, без фильтрации по совпадениям —
  // это "сырые данные", а не результат сверки)
  const wbHeader = ['Дата', 'Тип операции', 'Референс/номер', 'Описание', 'Сумма, руб.'];
  const wbData = agg.wbTxs.map(tx => [
    fmtDate(tx.transaction_date),
    tx.direction === 'OUT' ? 'Списание' : 'Начисление',
    tx.reference ?? '',
    tx.description ?? '',
    formatRub(tx.amount_kopeks ?? BigInt(0)),
  ]);
  const wsWb = XLSX.utils.aoa_to_sheet([wbHeader, ...wbData]);
  XLSX.utils.book_append_sheet(wb, wsWb, 'WB — исходные данные');

  // Лист 3: Банк — исходные данные, с честным флагом принадлежности к WB
  const bankHeader = ['Дата', 'Референс/номер', 'Описание', 'Сумма, руб.', 'Отнесено к WB'];
  const bankData = agg.bankTxs.map(tx => [
    fmtDate(tx.transaction_date),
    tx.reference ?? '',
    tx.description ?? '',
    formatRub(tx.amount_kopeks ?? BigInt(0)),
    agg.matchedBankTxIds.has(tx.id) ? 'Да' : 'Нет',
  ]);
  const wsBank = XLSX.utils.aoa_to_sheet([bankHeader, ...bankData]);
  XLSX.utils.book_append_sheet(wb, wsBank, 'Банк — исходные данные');

  // Лист 4: Метаданные
  const metaData = [
    ['Версия бота', 'bank_v2'],
    ['Алгоритм сверки', 'wb_net_payout'],
    ['Дата формирования файла', fmtDate(new Date())],
    ['UUID сверки', agg.runId],
    ['Хэш содержимого (проверка целостности)', agg.contentHash],
  ];
  const wsMeta = XLSX.utils.aoa_to_sheet(metaData);
  XLSX.utils.book_append_sheet(wb, wsMeta, 'Метаданные');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
