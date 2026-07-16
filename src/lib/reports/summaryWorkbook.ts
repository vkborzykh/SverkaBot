// Эта версия отдаёт ОДИН XLSX с тремя листами:
//   1. "Итого"        — суммарные цифры по всем кабинетам за период.
//   2. "По кабинетам"  — одна строка НА КАБИНЕТ (не на run), отсортировано
//                        по убыванию |разницы| — самые проблемные кабинеты
//                        оказываются первыми.
//   3. "Детализация"   — прежний построчный список сверок, для тех, кому
//                        нужно углубиться до конкретного run'а.
// Движок сверки — агрегатный (см. runAggregates.ts): один run = один агрегат
// "ожидалось vs получено" на весь WB-отчёт, без построчного сопоставления.

import * as XLSX from 'xlsx';
import {
  getRunAggregates,
  fmtDate,
  toRubNumber,
  applyRubNumberFormat,
  type RunAggregates,
} from './runAggregates';

async function collectAggregates(runIds: string[]): Promise<RunAggregates[]> {
  const out: RunAggregates[] = [];
  for (const id of runIds) {
    try {
      out.push(await getRunAggregates(id));
    } catch (err) {
      console.error(`[summaryWorkbook] run ${id} пропущен:`, err);
    }
  }
  return out;
}

function absBig(v: bigint): bigint {
  return v < BigInt(0) ? -v : v;
}

export interface CabinetTotal {
  cabinetName: string;
  runsCount: number;
  expectedKopeks: bigint;
  receivedKopeks: bigint;
  diffKopeks: bigint; // Σ expected − Σ received по кабинету; положительное = недоплата
  notFoundCount: number; // сколько run'ов кабинета не удалось агрегировать (см. runAggregates.NOT_FOUND)
}

/** Текстовый статус с эмодзи вместо заливки цвета (см. пояснение в шапке файла). */
export function emojiStatus(diffKopeks: bigint, hasNotFound: boolean): string {
  if (hasNotFound) return '⚪️ Требует проверки';
  if (diffKopeks === BigInt(0)) return '🟢 Совпало';
  if (diffKopeks > BigInt(0)) return '🔴 Недоплата';
  return '🟠 Переплата';
}

function groupByCabinet(aggregates: RunAggregates[]): CabinetTotal[] {
  const map = new Map<string, CabinetTotal>();
  for (const a of aggregates) {
    const key = a.cabinetName ?? '(без кабинета)';
    let t = map.get(key);
    if (!t) {
      t = {
        cabinetName: key,
        runsCount: 0,
        expectedKopeks: BigInt(0),
        receivedKopeks: BigInt(0),
        diffKopeks: BigInt(0),
        notFoundCount: 0,
      };
      map.set(key, t);
    }
    t.runsCount += 1;
    t.expectedKopeks += a.expectedKopeks;
    t.receivedKopeks += a.receivedKopeks;
    t.diffKopeks += a.diffKopeks;
    if (a.status === 'NOT_FOUND') t.notFoundCount += 1;
  }
  // Самые проблемные кабинеты — сверху, независимо от знака (недоплата и переплата
  // одинаково требуют внимания продавца).
  return Array.from(map.values()).sort((x, y) => {
    const ax = absBig(x.diffKopeks);
    const ay = absBig(y.diffKopeks);
    return ay > ax ? 1 : ay < ax ? -1 : 0;
  });
}

export interface SummaryWorkbookResult {
  buffer: Buffer;
  aggregates: RunAggregates[]; // для построения CTA-списка проблемных сверок вне этого модуля
  cabinetTotals: CabinetTotal[];
  totalExpectedKopeks: bigint;
  totalReceivedKopeks: bigint;
  totalDiffKopeks: bigint;
}

export async function buildSummaryWorkbook(runIds: string[]): Promise<SummaryWorkbookResult> {
  const aggregates = await collectAggregates(runIds);
  const cabinetTotals = groupByCabinet(aggregates);

  const totalExpectedKopeks = aggregates.reduce((s, a) => s + a.expectedKopeks, BigInt(0));
  const totalReceivedKopeks = aggregates.reduce((s, a) => s + a.receivedKopeks, BigInt(0));
  const totalDiffKopeks = totalExpectedKopeks - totalReceivedKopeks;

  const matchedCabinets = cabinetTotals.filter(c => c.notFoundCount === 0 && c.diffKopeks === BigInt(0)).length;
  const underpaidCabinets = cabinetTotals.filter(c => c.notFoundCount === 0 && c.diffKopeks > BigInt(0)).length;
  const overpaidCabinets = cabinetTotals.filter(c => c.notFoundCount === 0 && c.diffKopeks < BigInt(0)).length;
  const needsReviewCabinets = cabinetTotals.filter(c => c.notFoundCount > 0).length;

  const wb = XLSX.utils.book_new();

  // --- Лист 1: "Итого" ---
  const summaryRows: (string | number)[][] = [
    ['Сводный отчёт SverkaBot'],
    [],
    ['Кабинетов в отчёте', cabinetTotals.length],
    ['Сверок в отчёте', aggregates.length],
    [],
    ['Показатель', 'Сумма, ₽'],
    ['Ожидалось от WB (всего)', toRubNumber(totalExpectedKopeks)],
    ['Получено на счёт (всего)', toRubNumber(totalReceivedKopeks)],
    ['Разница (недоплата, если > 0)', toRubNumber(totalDiffKopeks)],
    [],
    ['Совпало', matchedCabinets],
    ['Недоплата', underpaidCabinets],
    ['Переплата', overpaidCabinets],
    ['Требует проверки', needsReviewCabinets],
  ];
  const summaryWs = XLSX.utils.aoa_to_sheet(summaryRows);
  summaryWs['!cols'] = [{ wch: 34 }, { wch: 18 }];
  for (const row of [7, 8, 9]) {
    const cell = summaryWs[`B${row}`];
    if (cell && cell.t === 'n') cell.z = '#,##0.00;[Red]-#,##0.00';
  }
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Итого');

  // --- Лист 2: "По кабинетам" ---
  const CAB_HEADER = ['Кабинет', 'Статус', 'Сверок за период', 'Ожидалось, ₽', 'Получено, ₽', 'Разница, ₽'];
  const cabRows: (string | number)[][] = [CAB_HEADER];
  for (const c of cabinetTotals) {
    cabRows.push([
      c.cabinetName,
      emojiStatus(c.diffKopeks, c.notFoundCount > 0),
      c.runsCount,
      toRubNumber(c.expectedKopeks),
      toRubNumber(c.receivedKopeks),
      toRubNumber(c.diffKopeks),
    ]);
  }
  const cabWs = XLSX.utils.aoa_to_sheet(cabRows);
  cabWs['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  applyRubNumberFormat(cabWs, ['D', 'E', 'F'], cabRows.length);
  XLSX.utils.book_append_sheet(wb, cabWs, 'По кабинетам');

  // --- Лист 3: "Детализация" (прежний построчный список, без изменений по смыслу) ---
  const DETAIL_HEADER = [
    'ID сверки',
    'Дата сверки',
    'Кабинет',
    'Период WB c',
    'Период WB по',
    'Ожидалось, ₽',
    'Получено, ₽',
    'Разница, ₽',
    'Статус',
  ];
  const detailRows: (string | number)[][] = [DETAIL_HEADER];
  for (const a of aggregates) {
    detailRows.push([
      a.runId,
      fmtDate(a.createdAt),
      a.cabinetName ?? '(без кабинета)',
      a.periodFrom,
      a.periodTo,
      toRubNumber(a.expectedKopeks),
      toRubNumber(a.receivedKopeks),
      toRubNumber(a.diffKopeks),
      a.statusLabel,
    ]);
  }
  const detailWs = XLSX.utils.aoa_to_sheet(detailRows);
  detailWs['!cols'] = [
    { wch: 10 }, { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 12 },
    { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 26 },
  ];
  applyRubNumberFormat(detailWs, ['F', 'G', 'H'], detailRows.length);
  XLSX.utils.book_append_sheet(wb, detailWs, 'Детализация');

  const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

  return { buffer, aggregates, cabinetTotals, totalExpectedKopeks, totalReceivedKopeks, totalDiffKopeks };
}
