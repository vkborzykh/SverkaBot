import type { CanonicalTransaction } from '@/src/db/repositories/canonical-transactions';
import type { ReconciliationRun } from '@/src/db/repositories/reconciliation-runs';
import type { ReconciliationMatch } from '@/src/db/repositories/reconciliation-matches';
import type { ReconciliationMatchItem } from '@/src/db/repositories/reconciliation-match-items';
import type { ReconciliationEvidence } from '@/src/db/repositories/reconciliation-evidence';
import type { ParsingError } from '@/src/db/repositories/parsing-errors';

const BOM = '\uFEFF';
const SEP = ';';

function escapeField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(SEP) || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function row(fields: unknown[]): string {
  return fields.map(escapeField).join(SEP);
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function formatDatetime(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function kopeksToRub(kopeks: bigint | string | number | null | undefined): string {
  if (kopeks === null || kopeks === undefined) return '0.00';
  const n = typeof kopeks === 'bigint' ? Number(kopeks) : Number(kopeks);
  return (n / 100).toFixed(2);
}

export function buildSummaryCSV(
  run: ReconciliationRun,
  lossEstimateKopeks: bigint,
): string {
  const headers = ['Параметр', 'Значение'];
  const rows = [
    ['ID сверки', run.id],
    ['Статус', run.status],
    ['Дата начала', formatDatetime(run.started_at)],
    ['Дата завершения', formatDatetime(run.completed_at)],
    ['Всего строк WB', run.total_wb_rows ?? 0],
    ['Всего строк банк', run.total_bank_rows ?? 0],
    ['Совпадений', run.matched_count ?? 0],
    ['Не найдено', run.unmatched_count ?? 0],
    ['Неоднозначных', run.ambiguous_count ?? 0],
    ['Разделённых (split)', run.split_count ?? 0],
    ['Объединённых (combined)', run.combined_count ?? 0],
    ['Процент совпадения', `${run.match_rate ?? '0'}%`],
    ['Сумма не найденных (₽)', kopeksToRub(run.unmatched_amount)],
    ['Сумма неоднозначных (₽)', kopeksToRub(run.ambiguous_amount)],
    ['Оценка потерь (₽)', kopeksToRub(lossEstimateKopeks)],
  ];

  return BOM + [row(headers), ...rows.map((r) => row(r))].join('\r\n') + '\r\n';
}

export interface MatchedRow {
  match_id: string;
  match_type: string;
  final_score: string | null;
  wb_tx: CanonicalTransaction | undefined;
  bank_tx: CanonicalTransaction | undefined;
}

export function buildMatchedCSV(matchedRows: MatchedRow[]): string {
  const headers = [
    'ID совпадения',
    'Тип',
    'Итоговый балл',
    'WB дата',
    'WB сумма (₽)',
    'WB описание',
    'WB ссылка',
    'Банк дата',
    'Банк сумма (₽)',
    'Банк описание',
    'Банк контрагент',
    'Банк ссылка',
  ];

  const lines = matchedRows.map((r) =>
    row([
      r.match_id,
      r.match_type,
      r.final_score ?? '',
      formatDate(r.wb_tx?.transaction_date),
      kopeksToRub(r.wb_tx?.amount_kopeks),
      r.wb_tx?.description ?? '',
      r.wb_tx?.reference ?? '',
      formatDate(r.bank_tx?.transaction_date),
      kopeksToRub(r.bank_tx?.amount_kopeks),
      r.bank_tx?.description ?? '',
      r.bank_tx?.counterparty ?? '',
      r.bank_tx?.reference ?? '',
    ]),
  );

  return BOM + [row(headers), ...lines].join('\r\n') + '\r\n';
}

export function buildUnmatchedCSV(txs: CanonicalTransaction[]): string {
  const headers = [
    'ID транзакции',
    'Дата',
    'Сумма (₽)',
    'Направление',
    'Описание',
    'Ссылка',
    'Контрагент',
    'Номер строки',
  ];

  const lines = txs.map((tx) =>
    row([
      tx.id,
      formatDate(tx.transaction_date),
      kopeksToRub(tx.amount_kopeks),
      tx.direction ?? '',
      tx.description ?? '',
      tx.reference ?? '',
      tx.counterparty ?? '',
      tx.row_number ?? '',
    ]),
  );

  return BOM + [row(headers), ...lines].join('\r\n') + '\r\n';
}

export function buildAmbiguousCSV(
  ambiguousRows: { match_id: string; wb_tx: CanonicalTransaction; candidates_count: number }[],
): string {
  const headers = [
    'ID совпадения',
    'WB ID транзакции',
    'WB дата',
    'WB сумма (₽)',
    'WB описание',
    'WB ссылка',
    'Кол-во кандидатов',
  ];

  const lines = ambiguousRows.map((r) =>
    row([
      r.match_id,
      r.wb_tx.id,
      formatDate(r.wb_tx.transaction_date),
      kopeksToRub(r.wb_tx.amount_kopeks),
      r.wb_tx.description ?? '',
      r.wb_tx.reference ?? '',
      r.candidates_count,
    ]),
  );

  return BOM + [row(headers), ...lines].join('\r\n') + '\r\n';
}

export function buildAllTransactionsCSV(txs: CanonicalTransaction[]): string {
  const headers = [
    'ID',
    'ID импорта',
    'Тип источника',
    'Номер строки',
    'Дата',
    'Сумма (₽)',
    'Валюта',
    'Направление',
    'Ссылка',
    'Описание',
    'Контрагент',
  ];

  const lines = txs.map((tx) =>
    row([
      tx.id,
      tx.import_id,
      tx.source_type ?? '',
      tx.row_number ?? '',
      formatDate(tx.transaction_date),
      kopeksToRub(tx.amount_kopeks),
      tx.currency ?? '',
      tx.direction ?? '',
      tx.reference ?? '',
      tx.description ?? '',
      tx.counterparty ?? '',
    ]),
  );

  return BOM + [row(headers), ...lines].join('\r\n') + '\r\n';
}

export function buildEvidenceCSV(
  evidenceRows: { match_id: string; match_type: string; evidence: ReconciliationEvidence }[],
): string {
  const headers = [
    'ID совпадения',
    'Тип',
    'Балл сумма',
    'Балл дата',
    'Балл ссылка',
    'Балл описание',
    'Балл контрагент',
    'Штрафы',
  ];

  const lines = evidenceRows.map((r) =>
    row([
      r.match_id,
      r.match_type,
      r.evidence.amount_score ?? '',
      r.evidence.date_score ?? '',
      r.evidence.reference_score ?? '',
      r.evidence.description_score ?? '',
      r.evidence.counterparty_score ?? '',
      r.evidence.penalties ? JSON.stringify(r.evidence.penalties) : '',
    ]),
  );

  return BOM + [row(headers), ...lines].join('\r\n') + '\r\n';
}

export function buildParsingErrorsCSV(errors: ParsingError[]): string {
  const headers = [
    'ID импорта',
    'Номер строки',
    'Код ошибки',
    'Сообщение',
    'Фрагмент данных',
  ];

  const lines = errors.map((e) =>
    row([
      e.import_id,
      e.row_number ?? '',
      e.error_code ?? '',
      e.error_message ?? '',
      e.raw_fragment ?? '',
    ]),
  );

  return BOM + [row(headers), ...lines].join('\r\n') + '\r\n';
}

export function buildMetricsCSV(run: ReconciliationRun): string {
  const headers = ['Метрика', 'Значение'];
  const totalWb = run.total_wb_rows ?? 0;
  const matchRate = run.match_rate ?? '0';
  const ambiguousRate = totalWb > 0
    ? ((run.ambiguous_count ?? 0) / totalWb * 100).toFixed(2)
    : '0';
  const splitRate = totalWb > 0
    ? ((run.split_count ?? 0) / totalWb * 100).toFixed(2)
    : '0';
  const combinedRate = totalWb > 0
    ? ((run.combined_count ?? 0) / totalWb * 100).toFixed(2)
    : '0';

  const rows = [
    ['Процент совпадения', `${matchRate}%`],
    ['Процент неоднозначных', `${ambiguousRate}%`],
    ['Процент разделённых (split)', `${splitRate}%`],
    ['Процент объединённых (combined)', `${combinedRate}%`],
    ['Всего строк WB', totalWb],
    ['Всего строк банк', run.total_bank_rows ?? 0],
    ['Совпадений', run.matched_count ?? 0],
    ['Не найдено', run.unmatched_count ?? 0],
    ['Неоднозначных', run.ambiguous_count ?? 0],
    ['Разделённых', run.split_count ?? 0],
    ['Объединённых', run.combined_count ?? 0],
  ];

  return BOM + [row(headers), ...rows.map((r) => row(r))].join('\r\n') + '\r\n';
}
