// src/lib/reports/exportCsv.ts
//
// CSV-реестр расхождений: ОДНА строка = ОДНА сверка (один run).
//
// Почему не "одна строка = одна банковская операция" (как было раньше):
// движок сверки (wbPayoutCore) сравнивает агрегированную сумму "К перечислению"
// по всему WB-отчёту с суммой зачисленных банковских поступлений WB — попарного
// сопоставления отдельных транзакций в движке нет. Прежняя реализация повторяла
// один и тот же агрегат (expected_payment, difference) в нескольких строках,
// подставляя в каждую разный received_payment — бухгалтер не мог понять, какая
// часть ожидаемой суммы покрыта какой строкой, а разница всегда выглядела "0"
// даже когда общая сумма не сходилась.
//
// Если нужна разбивка по отдельным банковским поступлениям — см. лист
// "Банк — исходные данные" в exportXlsx.ts. Там это показано честно: без
// утверждения, что конкретное поступление соответствует конкретной WB-строке.
//
// Формат "одна строка = один run" сделан намеренно так, чтобы его можно было
// без изменений переиспользовать для будущего сводного экспорта по нескольким
// кабинетам/периодам (см. пункт дорожной карты "cabinetsSummaryExport.ts") —
// достаточно вызвать getRunAggregates для каждого run и добавить строку.

import { getRunAggregates, formatRub, csvCell, fmtDate } from './runAggregates';

const SEP = ';';
const HEADER = [
  'report_id',
  'report_date',
  'cabinet_name',
  'wb_period_from',
  'wb_period_to',
  'expected_payment',
  'received_payment',
  'difference',
  'status',
  'bank_credits_count',
];

export async function buildCsvForRun(runId: string): Promise<Buffer> {
  const agg = await getRunAggregates(runId);

  const row = [
    agg.runId,
    fmtDate(agg.createdAt),
    csvCell(agg.cabinetName ?? ''),
    agg.periodFrom,
    agg.periodTo,
    formatRub(agg.expectedKopeks),
    formatRub(agg.receivedKopeks),
    formatRub(agg.diffKopeks),
    agg.statusLabel,
    String(agg.wbBankCredits.length),
  ];

  const lines = [HEADER.join(SEP), row.join(SEP)];
  // \uFEFF — BOM для корректного открытия в Excel с русскими буквами.
  return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8');
}
