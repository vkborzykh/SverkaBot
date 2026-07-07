// Генерация CSV-выгрузки транзакций WB (тариф «Бизнес»).
// Формат под Excel RU: BOM UTF-8, разделитель «;», CRLF, суммы «1234,56».
//
// buildCsvForRun — единственный источник правды: используется и в reportExport
// (фоновая генерация вместе с HTML), и в /export_csv (регенерация на лету,
// если файл истёк по retention или не создавался).

import { findTransactionsByImportId, type CanonicalTransaction } from '@/src/db/repositories/canonical-transactions';
import { findMatchesByRunId } from '@/src/db/repositories/reconciliation-matches';
import { findMatchItemsByMatchId } from '@/src/db/repositories/reconciliation-match-items';
import { findImportById } from '@/src/db/repositories/imports';
import { findCabinetById } from '@/src/db/repositories/wb-cabinets';

const SEP = ';';
const HEADER = [
  'Дата',
  'Тип',
  'Сумма',
  'Назначение',
  'Номер поставки (SRID)',
  'Кабинет',
  'Статус сверки',
];

export interface WbCsvRow {
  dateStr: string;
  type: 'Выплата' | 'Удержание' | 'Возврат';
  amountKopeks: bigint;
  description: string | null;
  srid: string | null;
  cabinetName: string | null;
  matchStatus: 'Найдено' | 'Не найдено' | 'Неоднозначно';
}

/** Экранирование по RFC 4180; переводы строк схлопываются в пробел. */
function cell(v: string | null | undefined): string {
  const s = (v ?? '').replace(/\r?\n/g, ' ').trim();
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** «1234,56» — запятая как десятичный разделитель, без разделителей тысяч:
 *  так Excel RU распознаёт число, а не строку. */
function amount(kopeks: bigint): string {
  const neg = kopeks < BigInt(0);
  const a = neg ? -kopeks : kopeks;
  return `${neg ? '-' : ''}${a / BigInt(100)},${(a % BigInt(100)).toString().padStart(2, '0')}`;
}

export function buildWbTransactionsCsv(rows: WbCsvRow[]): Buffer {
  const lines = [HEADER.join(SEP)];
  for (const r of rows) {
    lines.push(
      [
        cell(r.dateStr),
        cell(r.type),
        amount(r.amountKopeks),
        cell(r.description),
        cell(r.srid),
        cell(r.cabinetName),
        cell(r.matchStatus),
      ].join(SEP),
    );
  }
  // BOM обязателен: без него Excel на Windows покажет кириллицу кракозябрами
  return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8');
}

function matchStatusRu(matchType: string | null | undefined): WbCsvRow['matchStatus'] {
  if (matchType === 'MATCHED' || matchType === 'SPLIT_MATCHED' || matchType === 'COMBINED_MATCHED') {
    return 'Найдено';
  }
  if (matchType === 'AMBIGUOUS') return 'Неоднозначно';
  return 'Не найдено';
}

function rowType(tx: CanonicalTransaction): WbCsvRow['type'] {
  if ((tx.direction as string) === 'OUT') return 'Удержание';
  if (/возврат/i.test(tx.description ?? '')) return 'Возврат';
  return 'Выплата';
}

function fmtDmy(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

/**
 * Собирает массив строк транзакций WB со статусами сверки и кабинетом.
 * Используется как для CSV-выгрузки, так и для экспорта в Google Sheets.
 */
export async function collectWbCsvRows(run: {
  id: string;
  wb_import_id: string;
}): Promise<WbCsvRow[]> {
  const [wbTxs, matches] = await Promise.all([
    findTransactionsByImportId(run.wb_import_id),
    findMatchesByRunId(run.id),
  ]);

  // Карта: id WB-транзакции → тип матча
  const statusByWbTx = new Map<string, string>();
  for (const m of matches) {
    const items = await findMatchItemsByMatchId(m.id);
    for (const it of items) {
      if (it.side === 'WB') statusByWbTx.set(it.transaction_id, (m.match_type as string) ?? 'UNMATCHED');
    }
  }

  // Название кабинета (может отсутствовать — колонка будет пустой)
  let cabinetName: string | null = null;
  try {
    const wbImport = await findImportById(run.wb_import_id);
    const cabId = (wbImport as { cabinet_id?: string | null } | undefined)?.cabinet_id;
    if (cabId) cabinetName = (await findCabinetById(cabId))?.name ?? null;
  } catch (err) {
    console.error('[csvExport] cabinet lookup failed:', err);
  }

  const sorted = [...wbTxs].sort((a, b) => {
    const ta = a.transaction_date ? new Date(a.transaction_date).getTime() : 0;
    const tb = b.transaction_date ? new Date(b.transaction_date).getTime() : 0;
    return ta - tb;
  });

  return sorted.map((tx) => ({
    dateStr: fmtDmy(tx.transaction_date),
    type: rowType(tx),
    amountKopeks: tx.amount_kopeks ?? BigInt(0),
    description: tx.description,
    srid: tx.reference,
    cabinetName,
    matchStatus: matchStatusRu(statusByWbTx.get(tx.id)),
  }));
}

/** Собирает CSV по завершённой сверке из канонических данных. */
export async function buildCsvForRun(run: {
  id: string;
  wb_import_id: string;
}): Promise<Buffer> {
  const rows = await collectWbCsvRows(run);
  return buildWbTransactionsCsv(rows);
}
