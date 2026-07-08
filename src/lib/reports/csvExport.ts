// src/lib/reports/csvExport.ts
import { findTransactionsByImportId, type CanonicalTransaction } from '@/src/db/repositories/canonical-transactions';
import { findMatchesByRunId } from '@/src/db/repositories/reconciliation-matches';
import { findMatchItemsByMatchId } from '@/src/db/repositories/reconciliation-match-items';
import { findEvidenceByMatchId } from '@/src/db/repositories/reconciliation-evidence';
import { findImportById } from '@/src/db/repositories/imports';
import { findCabinetById } from '@/src/db/repositories/wb-cabinets';

const SEP = ';';

interface Summary {
  expectedKopeks: bigint;
  receivedKopeks: bigint;
  lossKopeks: bigint;
  matchRate: string;
}

interface TxRow {
  dateStr: string;
  type: string;
  amountKopeks: bigint;
  description: string | null;
  srid: string | null;
}

interface BankRow extends TxRow {
  isWb: boolean;
  counterparty: string | null;
}

export interface ReconciliationData {
  cabinetName: string | null;
  summary: Summary;
  wbRows: TxRow[];
  bankRows: BankRow[];
}

// Экранирование CSV
function cell(v: string | null | undefined): string {
  const s = (v ?? '').replace(/\r?\n/g, ' ').trim();
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function amount(kopeks: bigint): string {
  const neg = kopeks < BigInt(0);
  const a = neg ? -kopeks : kopeks;
  return `${neg ? '-' : ''}${a / BigInt(100)},${(a % BigInt(100)).toString().padStart(2, '0')}`;
}

function fmtDmy(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

/** Собирает все данные сверки для CSV и XLSX */
export async function collectReconciliationData(run: {
  id: string;
  wb_import_id: string;
  bank_import_id: string;
}): Promise<ReconciliationData> {
  const [wbTxs, bankTxs, matches] = await Promise.all([
    findTransactionsByImportId(run.wb_import_id),
    findTransactionsByImportId(run.bank_import_id),
    findMatchesByRunId(run.id),
  ]);

  // Название кабинета
  let cabinetName: string | null = null;
  try {
    const wbImport = await findImportById(run.wb_import_id);
    const cabId = (wbImport as { cabinet_id?: string | null } | undefined)?.cabinet_id;
    if (cabId) cabinetName = (await findCabinetById(cabId))?.name ?? null;
  } catch {}

  // Сводка из evidence первого матча типа wb_net_payout
  let summary: Summary = {
    expectedKopeks: BigInt(0),
    receivedKopeks: BigInt(0),
    lossKopeks: BigInt(0),
    matchRate: '0',
  };

  const wbNetMatch = matches.find(m => m.match_type === 'MATCHED' || m.match_type === 'COMBINED_MATCHED');
  if (wbNetMatch) {
    const ev = await findEvidenceByMatchId(wbNetMatch.id);
    const pen = ev?.penalties as Record<string, unknown> | undefined;
    if (pen && pen.strategy === 'wb_net_payout') {
      const expected = BigInt(String(pen.expected_net_kopeks ?? '0'));
      const received = BigInt(String(pen.received_kopeks ?? '0'));
      summary = {
        expectedKopeks: expected,
        receivedKopeks: received,
        lossKopeks: expected - received,
        matchRate: (expected > 0 ? (Number(received) / Number(expected) * 100).toFixed(1) : '0') + '%',
      };
    }
  }

  // Список bank-транзакций, участвовавших в матче
  const matchedBankIds = new Set<string>();
  for (const m of matches) {
    const items = await findMatchItemsByMatchId(m.id);
    for (const it of items) {
      if (it.side === 'BANK') matchedBankIds.add(it.transaction_id);
    }
  }

  // Формируем WB-строки (без статуса)
  const wbSorted = [...wbTxs].sort((a, b) => {
    const ta = a.transaction_date ? new Date(a.transaction_date).getTime() : 0;
    const tb = b.transaction_date ? new Date(b.transaction_date).getTime() : 0;
    return ta - tb;
  });

  const wbRows: TxRow[] = wbSorted.map(tx => ({
    dateStr: fmtDmy(tx.transaction_date),
    type: (tx.direction as string) === 'OUT' ? 'Удержание' : 'Выплата',
    amountKopeks: tx.amount_kopeks ?? BigInt(0),
    description: tx.description,
    srid: tx.reference,
  }));

  // Формируем банковские строки (все поступления, с пометкой WB)
  const bankCredits = bankTxs.filter(t => (t.direction as string) !== 'OUT');
  const bankSorted = bankCredits.sort((a, b) => {
    const ta = a.transaction_date ? new Date(a.transaction_date).getTime() : 0;
    const tb = b.transaction_date ? new Date(b.transaction_date).getTime() : 0;
    return ta - tb;
  });

  const bankRows: BankRow[] = bankSorted.map(tx => ({
    dateStr: fmtDmy(tx.transaction_date),
    type: 'Поступление',
    amountKopeks: tx.amount_kopeks ?? BigInt(0),
    description: tx.description,
    srid: tx.reference,
    isWb: matchedBankIds.has(tx.id),
    counterparty: tx.counterparty,
  }));

  return { cabinetName, summary, wbRows, bankRows };
}

/** Генерирует CSV-буфер */
export async function buildCsvForRun(run: {
  id: string;
  wb_import_id: string;
  bank_import_id: string;
}): Promise<Buffer> {
  const data = await collectReconciliationData(run);
  const lines: string[] = [];

  lines.push(`Сверка WB${data.cabinetName ? `, кабинет: ${data.cabinetName}` : ''}`);
  lines.push(`Ожидалось к выплате;${amount(data.summary.expectedKopeks)}`);
  lines.push(`Поступило от WB;${amount(data.summary.receivedKopeks)}`);
  lines.push(`Расхождение;${amount(data.summary.lossKopeks)}`);
  lines.push(`Совпадение;${data.summary.matchRate}`);
  lines.push('');

  // Таблица WB
  lines.push('Отчёт WB');
  lines.push(['Дата', 'Тип', 'Сумма', 'Назначение', 'Номер поставки'].join(SEP));
  for (const r of data.wbRows) {
    lines.push([
      cell(r.dateStr), cell(r.type), amount(r.amountKopeks),
      cell(r.description), cell(r.srid),
    ].join(SEP));
  }

  lines.push('');
  lines.push('Банковские поступления');
  lines.push(['Дата', 'Сумма', 'Отправитель', 'Назначение', 'От WB'].join(SEP));
  for (const r of data.bankRows) {
    lines.push([
      cell(r.dateStr), amount(r.amountKopeks),
      cell(r.counterparty), cell(r.description),
      r.isWb ? 'Да' : 'Нет',
    ].join(SEP));
  }

  return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8');
}
