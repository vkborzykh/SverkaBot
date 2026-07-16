// src/lib/reports/combinedExport.ts
// Сводный экспорт (CSV / XLSX / 1С) по нескольким run'ам.
// Использует агрегаты runAggregates, НЕ склеивает готовые файлы через Buffer.concat.
import * as XLSX from 'xlsx';
import {
  getRunAggregates,
  formatRub,
  csvCell,
  fmtDate,
  COUNTERPARTY_BY_MARKETPLACE,
  toRubNumber,
  applyRubNumberFormat,
  type RunAggregates,
} from './runAggregates';

const SEP = ';';

async function collectAggregates(runIds: string[]): Promise<RunAggregates[]> {
  const out: RunAggregates[] = [];
  for (const id of runIds) {
    try {
      out.push(await getRunAggregates(id));
    } catch (err) {
      console.error(`[combinedExport] run ${id} пропущен:`, err);
    }
  }
  return out;
}

const CSV_HEADER = [
  'report_id', 'report_date', 'cabinet_name', 'wb_period_from', 'wb_period_to',
  'expected_payment', 'received_payment', 'difference', 'status', 'bank_credits_count',
];

export async function buildCombinedCsv(runIds: string[]): Promise<Buffer> {
  const aggs = await collectAggregates(runIds);
  const rows = aggs.map(agg => [
    agg.runId, fmtDate(agg.createdAt), csvCell(agg.cabinetName ?? ''),
    agg.periodFrom, agg.periodTo, formatRub(agg.expectedKopeks),
    formatRub(agg.receivedKopeks), formatRub(agg.diffKopeks),
    agg.statusLabel, String(agg.wbBankCredits.length),
  ].join(SEP));
  const lines = [CSV_HEADER.join(SEP), ...rows];
  return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8');
}

const ONEC_HEADER = [
  'ID сверки', 'Дата сверки', 'Кабинет WB', 'Период отчёта WB', 'Контрагент',
  'Документ-основание', 'Ожидалось, руб.', 'Получено, руб.', 'Разница, руб.', 'Статус',
];

export async function buildCombined1c(runIds: string[]): Promise<Buffer> {
  const aggs = await collectAggregates(runIds);
  const rows = aggs.map(agg => {
    const counterparty = COUNTERPARTY_BY_MARKETPLACE[agg.marketplace] ?? COUNTERPARTY_BY_MARKETPLACE.WB;
    const periodLabel = agg.periodFrom && agg.periodTo ? `${agg.periodFrom} – ${agg.periodTo}` : '';
    const basisDocument = [
      `Отчёт WB за период ${periodLabel}`,
      agg.cabinetName ? `кабинет «${agg.cabinetName}»` : null,
    ].filter(Boolean).join(', ');
    return [
      agg.runId, fmtDate(agg.createdAt), csvCell(agg.cabinetName ?? ''), periodLabel,
      csvCell(counterparty), csvCell(basisDocument), formatRub(agg.expectedKopeks),
      formatRub(agg.receivedKopeks), formatRub(agg.diffKopeks), agg.statusLabel,
    ].join(SEP);
  });
  const lines = [ONEC_HEADER.join(SEP), ...rows];
  return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8');
}

export async function buildCombinedXlsx(runIds: string[]): Promise<Buffer> {
  const aggs = await collectAggregates(runIds);
  const header = [
    'ID сверки', 'Дата', 'Кабинет WB', 'Период с', 'Период по',
    'Ожидалось, руб.', 'Получено, руб.', 'Разница, руб.', 'Статус', 'Банк. поступлений WB',
  ];
  const rows: (string | number)[][] = [header, ...aggs.map(agg => [
    agg.runId, fmtDate(agg.createdAt), agg.cabinetName ?? '—', agg.periodFrom, agg.periodTo,
    toRubNumber(agg.expectedKopeks), toRubNumber(agg.receivedKopeks), toRubNumber(agg.diffKopeks),
    agg.statusLabel, agg.wbBankCredits.length,
  ])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  applyRubNumberFormat(ws, ['F', 'G', 'H'], rows.length); // денежные колонки
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Сводка по сверкам');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
