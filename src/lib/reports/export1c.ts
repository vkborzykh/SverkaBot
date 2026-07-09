// src/lib/reports/export1c.ts
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findMatchesByRunId } from '@/src/db/repositories/reconciliation-matches';
import { findMatchItemsByMatchId } from '@/src/db/repositories/reconciliation-match-items';
import { findEvidenceByMatchId } from '@/src/db/repositories/reconciliation-evidence';
import { findTransactionsByImportId } from '@/src/db/repositories/canonical-transactions';

const SEP = ';';
const HEADER = [
  'Дата операции',
  'Контрагент',
  'Документ',
  'Ожидалось',
  'Получено',
  'Разница',
  'Статус',
  'Основание',
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

export async function build1cForRun(runId: string): Promise<Buffer> {
  const run = await findRunById(runId);
  if (!run) throw new Error('Run not found');

  const [wbTxs, bankTxs, matches] = await Promise.all([
    findTransactionsByImportId(run.wb_import_id),
    findTransactionsByImportId(run.bank_import_id),
    findMatchesByRunId(run.id),
  ]);

  // Идентифицируем банковские транзакции WB
  const matchedBankTxIds = new Set<string>();
  let expectedKopeks = BigInt(0);
  let receivedKopeks = BigInt(0);

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
    }
  }

  const wbOutTxs = wbTxs.filter(t => t.direction !== 'OUT');
  const bankCredits = bankTxs.filter(t => t.direction !== 'OUT');
  const wbBankCredits = bankCredits.filter(t => matchedBankTxIds.has(t.id));

  const lines = [HEADER.join(SEP)];

  // Если есть банковские поступления WB, формируем строки по ним
  if (wbBankCredits.length > 0) {
    for (const bankTx of wbBankCredits) {
      const txExpected = wbOutTxs.length > 0 ? rubNum(expectedKopeks) : rubNum(BigInt(0)); // ожидалось общее
      const txReceived = rubNum(bankTx.amount_kopeks ?? BigInt(0));
      const diff = txExpected - txReceived;
      const status = diff === 0 ? 'Совпало' : diff > 0 ? 'Недоплата' : 'Переплата';
      const row = [
        fmtDate(bankTx.transaction_date),
        'ООО «Вайлдберриз»',
        bankTx.reference ?? '',
        String(txExpected),
        String(txReceived),
        String(diff),
        status,
        bankTx.description ?? '',
      ];
      lines.push(row.join(SEP));
    }
  } else {
    // Нет найденных банковских операций — одна строка с общей недоплатой
    const diff = rubNum(expectedKopeks - receivedKopeks);
    const status = diff === 0 ? 'Совпало' : 'Недоплата';
    lines.push([
      '',
      'ООО «Вайлдберриз»',
      '',
      String(rubNum(expectedKopeks)),
      String(rubNum(receivedKopeks)),
      String(diff),
      status,
      'Сверка не выявила отдельных поступлений',
    ].join(SEP));
  }

  return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8');
}

function rubNum(kopeks: bigint): number {
  return Number(kopeks) / 100;
}
