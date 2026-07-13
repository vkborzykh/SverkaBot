// src/lib/reports/runAggregates.ts
//
// Единая точка расчёта агрегатов сверки для ВСЕХ форматов экспорта (CSV, XLSX, 1С).
//
// Почему это отдельный модуль, а не копия кода в каждом экспортёре:
// движок сверки (wbPayoutCore) сравнивает ОДИН агрегат за весь WB-отчёт —
// Σ "К перечислению" (WB) против Σ зачисленных банковских поступлений WB.
// Попарного сопоставления отдельных WB-строк с отдельными банковскими
// операциями в движке нет. Экспортные форматы не должны изобретать такое
// соответствие — именно на этом ранее ломались exportCsv/exportXlsx/export1c
// (агрегат тиражировался построчно, что вводило в заблуждение).
//
// Раньше эта логика была продублирована в трёх файлах почти дословно и уже
// успела разойтись (например, export1c.ts не использовал ту же денежную
// функцию, что exportCsv.ts). Вынос в один модуль устраняет класс таких багов
// на будущее.

import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findMatchesByRunId } from '@/src/db/repositories/reconciliation-matches';
import { findMatchItemsByMatchId } from '@/src/db/repositories/reconciliation-match-items';
import { findEvidenceByMatchId } from '@/src/db/repositories/reconciliation-evidence';
import {
  findTransactionsByImportId,
  type CanonicalTransaction,
} from '@/src/db/repositories/canonical-transactions';
import { findImportById } from '@/src/db/repositories/imports';
import { findCabinetById } from '@/src/db/repositories/wb-cabinets';
import { sha256 } from '@/src/lib/ingestion/hash';
import * as XLSX from 'xlsx';

export type RunAggregateStatus = 'MATCHED' | 'UNDERPAID' | 'OVERPAID' | 'NOT_FOUND';

export interface RunAggregates {
  runId: string;
  createdAt: Date | string | null;
  cabinetName: string | null;
  marketplace: string;
  periodFrom: string; // DD.MM.YYYY
  periodTo: string;
  expectedKopeks: bigint;
  receivedKopeks: bigint;
  diffKopeks: bigint; // expected - received; положительное = недоплата
  status: RunAggregateStatus;
  statusLabel: string;
  wbTxs: CanonicalTransaction[];
  bankTxs: CanonicalTransaction[];
  wbBankCredits: CanonicalTransaction[]; // банковские поступления, отнесённые к WB
  matchedBankTxIds: Set<string>;
  contentHash: string; // хэш реального содержимого (НЕ хэш runId — см. баг в старой версии)
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

/**
 * Денежное форматирование БЕЗ плавающей точки — только целочисленная
 * арифметика над копейками. Правило проекта: "Never use float or double
 * for money". Старая версия export1c.ts/exportXlsx.ts нарушала это через
 * rubNum() = Number(kopeks) / 100.
 */
export function formatRub(kopeks: bigint): string {
  const neg = kopeks < BigInt(0);
  const abs = neg ? -kopeks : kopeks;
  const rub = abs / BigInt(100);
  const kop = (abs % BigInt(100)).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${rub},${kop}`;
}

/** Число рублей ТОЛЬКО для числовых ячеек XLSX (Excel сам считает/форматирует).
 *  Источник истины остаётся bigint-копейками — эта функция не участвует в расчётах,
 *  только в отображении уже готового значения. */
export function toRubNumber(kopeks: bigint): number {
  return Number(kopeks) / 100;
}

const RUB_NUMFMT = '#,##0.00;[Red]-#,##0.00';

/** Проставляет числовой формат (разряды + 2 знака) на диапазон числовых ячеек. */
export function applyRubNumberFormat(ws: XLSX.WorkSheet, cols: string[], rowCount: number): void {
  for (const col of cols) {
    for (let r = 2; r <= rowCount; r++) {
      const cell = ws[`${col}${r}`];
      if (cell && cell.t === 'n') cell.z = RUB_NUMFMT;
    }
  }
}

const RISKY_LEADING_CHARS = /^[=+\-@\t\r]/;

/** Экранирование текстового поля для CSV/1С (разделитель ';', кавычки, переносы строк).
 *  Добавлена защита от CSV/Excel-инъекции. */
export function csvCell(v: string | null | undefined): string {
  let s = (v ?? '').replace(/\r?\n/g, ' ').trim();
  if (RISKY_LEADING_CHARS.test(s)) s = `'${s}`;
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const COUNTERPARTY_BY_MARKETPLACE: Record<string, string> = {
  WB: 'ООО «Вайлдберриз»',
};

export async function getRunAggregates(runId: string): Promise<RunAggregates> {
  const run = await findRunById(runId);
  if (!run) throw new Error('Run not found');

  const [wbTxs, bankTxs, matches] = await Promise.all([
    findTransactionsByImportId(run.wb_import_id),
    findTransactionsByImportId(run.bank_import_id),
    findMatchesByRunId(run.id),
  ]);

  const wbImport = await findImportById(run.wb_import_id);
  const wbImportAny = wbImport as any;

  let cabinetName: string | null = null;
  try {
    const cabId = wbImportAny?.cabinet_id;
    if (cabId) cabinetName = (await findCabinetById(cabId))?.name ?? null;
  } catch {
    // отсутствие кабинета не должно ронять экспорт
  }

  const matchedBankTxIds = new Set<string>();
  const aggregateCandidates: { expectedKopeks: bigint; receivedKopeks: bigint }[] = [];

  for (const m of matches) {
    const items = await findMatchItemsByMatchId(m.id);
    for (const it of items) {
      if (it.side === 'BANK') matchedBankTxIds.add(it.transaction_id);
    }
    const ev = await findEvidenceByMatchId(m.id);
    const pen = ev?.penalties as Record<string, unknown> | undefined;
    if (pen?.strategy === 'wb_net_payout') {
      aggregateCandidates.push({
        expectedKopeks: BigInt(String(pen.expected_net_kopeks ?? '0')),
        receivedKopeks: BigInt(String(pen.received_kopeks ?? '0')),
      });
    }
  }

  // Инвариант движка: на run должен приходиться РОВНО ОДИН агрегат wb_net_payout.
  // Раньше при нарушении этого инварианта значения молча перезаписывались.
  // Теперь как минимум логируем — это сигнал для расследования, а не тихий сбой.
  if (aggregateCandidates.length > 1) {
    console.warn(
      `[export] run ${runId}: найдено ${aggregateCandidates.length} агрегатов wb_net_payout, ожидался 1. Используется последний найденный.`,
    );
  }
  if (aggregateCandidates.length === 0) {
    console.warn(
      `[export] run ${runId}: не найден агрегат wb_net_payout — экспорт покажет 0/0. Проверьте, всегда ли движок сверки создаёт evidence-запись для полностью неоплаченных ranов.`,
    );
  }

  const agg = aggregateCandidates[aggregateCandidates.length - 1] ?? {
    expectedKopeks: BigInt(0),
    receivedKopeks: BigInt(0),
  };

  const diffKopeks = agg.expectedKopeks - agg.receivedKopeks;
  let status: RunAggregateStatus;
  let statusLabel: string;
  if (aggregateCandidates.length === 0) {
    status = 'NOT_FOUND';
    statusLabel = 'Не определено — проверьте run вручную';
  } else if (diffKopeks === BigInt(0)) {
    status = 'MATCHED';
    statusLabel = 'Совпало';
  } else if (diffKopeks > BigInt(0)) {
    status = 'UNDERPAID';
    statusLabel = 'Недоплата';
  } else {
    status = 'OVERPAID';
    statusLabel = 'Переплата';
  }

  const wbBankCredits = bankTxs.filter(t => matchedBankTxIds.has(t.id) && t.direction !== 'OUT');

  const contentHash = sha256(
    Buffer.from(
      JSON.stringify({
        runId,
        expected: agg.expectedKopeks.toString(),
        received: agg.receivedKopeks.toString(),
        wbRowHashes: wbTxs.map(t => (t as any).row_hash ?? t.id).sort(),
        bankRowHashes: bankTxs.map(t => (t as any).row_hash ?? t.id).sort(),
      }),
    ),
  ).slice(0, 16);

  return {
    runId,
    createdAt: run.created_at,
    cabinetName,
    marketplace: wbImportAny?.marketplace ?? 'WB',
    periodFrom: fmtDate(wbImportAny?.period_start),
    periodTo: fmtDate(wbImportAny?.period_end),
    expectedKopeks: agg.expectedKopeks,
    receivedKopeks: agg.receivedKopeks,
    diffKopeks,
    status,
    statusLabel,
    wbTxs,
    bankTxs,
    wbBankCredits,
    matchedBankTxIds,
    contentHash,
  };
}
