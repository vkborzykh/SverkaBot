// src/lib/reports/exportXlsx.ts
//
// XLSX-выгрузка: "Сводка" (агрегат по run) + ПОЛНЫЕ сырые данные WB и банка
// каждые на своём листе.
//
// Что убрано по сравнению с прошлой версией и почему:
// - Листы "Недоплаты" и "Все выплаты" удалены полностью. Они пытались
//   показать попарное соответствие WB-строка <-> банковская операция,
//   которого нет в движке сверки (сравнивается только агрегат за весь
//   отчёт). Патчить их точечно нельзя — сама идея строки в проекте неверна.
// - Вместо них — лист "Банк — исходные данные" с честным флагом
//   "Отнесено к WB" (да/нет) на каждую банковскую строку. Это не выдуманное
//   соответствие конкретной WB-строке, а реальный факт, который движок
//   действительно вычисляет: было ли поступление учтено как WB-платёж.
// - Денежные суммы теперь через toRubNumber() (числовые ячейки с форматированием)
//   вместо formatRub() (текст), что позволяет суммировать и фильтровать в Excel.
// - Лист «Метаданные» удалён полностью — ID сверки и другая техническая
//   информация не несут ценности для продавца или бухгалтера.
// - Формат ячейки «Разница» теперь двухцветный: зелёный для положительных,
//   красный для отрицательных (условное форматирование по знаку).

// - Лист «Претензия» добавляется только если есть непокрытые WB-строки с
//   высокой уверенностью (сверено с агрегатом в claimBuilder.ts) — иначе
//   лист не создаётся вовсе, чтобы не показывать недостоверную разбивку.

import * as XLSX from 'xlsx';
import {
  getRunAggregates,
  formatRub,
  toRubNumber,
  applyRubNumberFormat,
  fmtDate,
} from './runAggregates';
import { buildRowLevelClaim } from '@/src/lib/reconciliation/claimBuilder';

const RUB_FMT = '#,##0.00;[Red]-#,##0.00';
const DIFF_FMT = '[Green]#,##0.00;[Red]-#,##0.00';

export async function buildXlsxForRun(runId: string): Promise<Buffer> {
  const agg = await getRunAggregates(runId);

  const wb = XLSX.utils.book_new();

  // Лист 1: Сводка (с пояснительной шапкой для бухгалтера)
  const summaryData: (string | number)[][] = [
    ['СВЕРКА ВЫПЛАТ WILDBERRIES'],
    [''],
    ['Этот файл сформирован ботом SverkaBot и содержит результат сверки еженедельного отчёта WB с банковской выпиской.'],
    ['Лист «Сводка» — ключевые цифры: сколько ожидалось, сколько поступило, размер расхождения.'],
    ['Лист «WB» — перечень всех начислений и удержаний из отчёта Wildberries за период.'],
    ['Лист «Банк» — все операции из банковской выписки с пометкой, какие из них являются выплатами WB.'],
    ['Если сумма в строке «Разница» выделена зелёным — поступило больше ожидаемого. Красным — недоплата.'],
    [''],
    ['ID сверки', agg.runId],
    ['Дата сверки', fmtDate(agg.createdAt)],
    ['Кабинет WB', agg.cabinetName ?? '—'],
    ['Период отчёта WB', `${agg.periodFrom} – ${agg.periodTo}`],
    ['Ожидалось, руб.', toRubNumber(agg.expectedKopeks)],
    ['Получено, руб.', toRubNumber(agg.receivedKopeks)],
    ['Разница, руб.', toRubNumber(agg.diffKopeks)],
    ['Статус', agg.statusLabel],
    ['Строк в WB-отчёте', agg.wbTxs.length],
    ['Банковских поступлений, отнесённых к WB', agg.wbBankCredits.length],
    ['Всего банковских операций в выписке', agg.bankTxs.length],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
  // Применяем числовой формат для денежных строк (строки 13,14 в колонке B) и строки 15 (Разница)
  const rowOffset = 8; // первые 8 строк — пояснения
  for (const row of [rowOffset + 5, rowOffset + 6]) {
    const cell = wsSummary[`B${row}`];
    if (cell && cell.t === 'n') cell.z = RUB_FMT;
  }
  const diffCell = wsSummary[`B${rowOffset + 7}`];
  if (diffCell && diffCell.t === 'n') diffCell.z = DIFF_FMT;
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Сводка');

  // Лист «Претензия» — только если есть непокрытые WB-строки с высокой
  // уверенностью (claimBuilder сверяет сумму с уже провалидированным
  // агрегатом agg.diffKopeks; см. src/lib/reconciliation/claimBuilder.ts).
  if (agg.diffKopeks > BigInt(0)) {
    const claim = await buildRowLevelClaim(agg.runId, agg.wbTxs, agg.diffKopeks);
    if (claim && claim.confidence === 'high' && claim.rows.length > 0) {
      const claimHeader = ['Дата начисления', 'Референс/номер', 'Описание', 'Сумма, руб.'];
      const claimRows: (string | number)[][] = claim.rows.map((r) => [
        r.dateStr,
        r.reference ?? '',
        r.description ?? '',
        toRubNumber(r.amountKopeks),
      ]);
      const claimTotalRow = ['', '', 'Итого не подтверждено', toRubNumber(claim.sumUnmatchedKopeks)];
      const wsClaim = XLSX.utils.aoa_to_sheet([
        ['Строки WB, для которых не найдено соответствующее поступление в банковской выписке'],
        [''],
        claimHeader,
        ...claimRows,
        [''],
        claimTotalRow,
      ]);
      applyRubNumberFormat(wsClaim, ['D'], claimRows.length + 3);
      const totalRowIdx = claimRows.length + 5; // 1 (заголовок листа) + 1 (пустая) + 1 (шапка таблицы) + N строк + 1 (пустая) + сама строка итога
      const totalCell = wsClaim[`D${totalRowIdx}`];
      if (totalCell && totalCell.t === 'n') totalCell.z = RUB_FMT;
      XLSX.utils.book_append_sheet(wb, wsClaim, 'Претензия');
    }
  }

  // Лист 2: WB — исходные данные
  const wbHeader = ['Дата', 'Тип операции', 'Референс/номер', 'Описание', 'Сумма, руб.'];
  const wbRows: (string | number)[][] = agg.wbTxs.map(tx => [
    fmtDate(tx.transaction_date),
    tx.direction === 'OUT' ? 'Списание' : 'Начисление',
    tx.reference ?? '',
    tx.description ?? '',
    toRubNumber(tx.amount_kopeks ?? BigInt(0)),
  ]);
  const wsWb = XLSX.utils.aoa_to_sheet([wbHeader, ...wbRows]);
  applyRubNumberFormat(wsWb, ['E'], wbRows.length + 1);
  XLSX.utils.book_append_sheet(wb, wsWb, 'WB — исходные данные');

  // Лист 3: Банк — исходные данные
  const bankHeader = ['Дата', 'Контрагент', 'Референс/номер', 'Описание', 'Сумма, руб.', 'Отнесено к WB'];
  const bankRows: (string | number)[][] = agg.bankTxs.map(tx => [
    fmtDate(tx.transaction_date),
    tx.counterparty ?? '',
    tx.reference ?? '',
    tx.description ?? '',
    toRubNumber(tx.amount_kopeks ?? BigInt(0)),
    agg.matchedBankTxIds.has(tx.id) ? 'Да' : 'Нет',
  ]);
  const wsBank = XLSX.utils.aoa_to_sheet([bankHeader, ...bankRows]);
  applyRubNumberFormat(wsBank, ['E'], bankRows.length + 1);
  XLSX.utils.book_append_sheet(wb, wsBank, 'Банк — исходные данные');

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
