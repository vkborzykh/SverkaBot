// src/lib/reports/exportCsv.ts
// Генератор CSV с результатами сверки для тарифа BUSINESS.
// Каждая строка — одна выплата Wildberries (банковское поступление, идентифицированное как WB).

import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findMatchesByRunId } from '@/src/db/repositories/reconciliation-matches';
import { findMatchItemsByMatchId } from '@/src/db/repositories/reconciliation-match-items';
import { findEvidenceByMatchId } from '@/src/db/repositories/reconciliation-evidence';
import { findTransactionsByImportId } from '@/src/db/repositories/canonical-transactions';
import { findImportById } from '@/src/db/repositories/imports';

const SEP = ';';
const HEADER = [
  'report_id',
  'report_date',
  'wb_period_from',
  'wb_period_to',
  'payment_number',
  'expected_payment',
  'received_payment',
  'difference',
  'status',
  'bank_operation_date',
  'bank_description',
  'wb_document_type',
];

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

function amount(kopeks: bigint): string {
  const neg = kopeks < BigInt(0);
  const a = neg ? -kopeks : kopeks;
  return `${neg ? '-' : ''}${a / BigInt(100)},${(a % BigInt(100)).toString().padStart(2, '0')}`;
}

function cell(v: string | null | undefined): string {
  const s = (v ?? '').replace(/\r?\n/g, ' ').trim();
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function buildCsvForRun(runId: string): Promise<Buffer> {
  const run = await findRunById(runId);
  if (!run) throw new Error('Run not found');

  // Данные о периоде WB-отчёта
  const wbImport = await findImportById(run.wb_import_id);
  const periodFrom = wbImport?.period_start ? fmtDate(wbImport.period_start) : '';
  const periodTo = wbImport?.period_end ? fmtDate(wbImport.period_end) : '';

  // Получаем банковские транзакции и матчи
  const bankTxs = await findTransactionsByImportId(run.bank_import_id);
  const matches = await findMatchesByRunId(run.id);

  // Идентифицируем банковские поступления, отнесённые к WB
  const matchedBankTxIds = new Set<string>();
  let expectedKopeks = BigInt(0);
  let receivedKopeks = BigInt(0);
  let aggStatus: 'Совпало' | 'Недоплата' | 'Не найдено' = 'Не найдено';

  for (const m of matches) {
    const items = await findMatchItemsByMatchId(m.id);
    for (const it of items) {
      if (it.side === 'BANK') matchedBankTxIds.add(it.transaction_id);
    }
    const ev = await findEvidenceByMatchId(m.id);
    const pen = ev?.penalties as Record<string, unknown> | undefined;
    if (pen?.strategy === 'wb_net_payout') {
      expectedKopeks = BigInt(String(pen.expected_net_kopeks ?? '0'));
      receivedKopeks = BigInt(String(pen.received_kopeks ?? '0'));
      const diff = expectedKopeks - receivedKopeks;
      if (diff === BigInt(0)) aggStatus = 'Совпало';
      else if (diff > BigInt(0)) aggStatus = 'Недоплата';
      else aggStatus = 'Не найдено';
    }
  }

  const wbBankCredits = bankTxs.filter(t => matchedBankTxIds.has(t.id) && t.direction !== 'OUT');

  // Если нет ни одной банковской выплаты WB, формируем одну строку с общей сводкой
  if (wbBankCredits.length === 0) {
    const row = [
      runId,
      fmtDate(run.created_at),
      periodFrom,
      periodTo,
      '',
      amount(expectedKopeks),
      amount(receivedKopeks),
      amount(expectedKopeks - receivedKopeks),
      aggStatus,
      '',
      '',
      '',
    ];
    const lines = [HEADER.join(SEP), row.join(SEP)];
    return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8');
  }

  // Формируем строки для каждой банковской операции
  const lines = [HEADER.join(SEP)];
  for (const tx of wbBankCredits) {
    const txAmount = tx.amount_kopeks ?? BigInt(0);
    const row = [
      runId,
      fmtDate(run.created_at),
      periodFrom,
      periodTo,
      tx.reference ?? '',
      amount(expectedKopeks),      // общее ожидаемое
      amount(txAmount),            // конкретное поступление
      amount(expectedKopeks - receivedKopeks), // общая разница
      aggStatus,
      fmtDate(tx.transaction_date),
      tx.description ?? '',
      'Продажа',
    ];
    lines.push(row.join(SEP));
  }
  return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8');
}
