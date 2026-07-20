// Построчная разбивка для «Данных для претензии» в HTML-отчёте.
//
// Использует только persisted reconciliation_candidates (жёсткие фильтры:
// направление, валюта, сумма, окно дат — см. candidates.ts). НЕ использует
// scoring/assignment/split-combined — та часть построчного движка пока
// работает только в shadow-режиме (см. runRowLevelShadow в reconcile.ts,
// Этап 3 дорожной карты) и ещё не провалидирована для показа пользователю.
//
// Логика: WB-строка входящего направления, для которой НЕТ ни одного
// кандидата (ни одной банковской операции той же суммы в пределах окна дат),
// с высокой вероятностью не поступила — это уже достаточно сильный сигнал
// без скоринга/ассайнмента.
//
// Результат обязательно сверяется с уже провалидированной агрегатной суммой
// (loss_kopeks из wbPayoutCore). Если сумма непокрытых строк заметно
// расходится с агрегатом — считаем данные низкой уверенности и НЕ отдаём
// построчную разбивку: вызывающий код должен откатиться на старое поведение.
// Это осознанное ограничение: пока assignment/scoring не сверены на реальных
// данных (Этап 3), лучше показать меньше, чем показать неверное.

import { findCandidatesByRunId } from '@/src/db/repositories/reconciliation-candidates';
import { generateCandidates } from '@/src/lib/reconciliation/candidates';
import type { CanonicalTransaction } from '@/src/db/repositories/canonical-transactions';

export interface RowLevelClaimRow {
  dateStr: string;
  amountKopeks: bigint;
  reference: string | null;
  description: string | null;
}

export interface RowLevelClaimResult {
  rows: RowLevelClaimRow[];
  sumUnmatchedKopeks: bigint;
  confidence: 'high' | 'low';
}

const TOLERANCE_PERCENT = 5; // 5% допуска между агрегатом и суммой непокрытых строк
const TOLERANCE_MIN_KOPEKS = BigInt(50000); // не меньше 500 ₽ допуска (защита от деления на копейки)

function fmtDmy(d: Date | string | null | undefined): string {
  const dt = d ? new Date(d) : null;
  if (!dt || isNaN(dt.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

function timeOf(d: Date | string | null | undefined): number {
  const t = d ? new Date(d).getTime() : NaN;
  return isNaN(t) ? 0 : t;
}

/**
 * Пытается построить построчную претензию. Возвращает null, если данных
 * недостаточно или уверенность низкая — в этом случае вызывающий код обязан
 * откатиться на старое (агрегатное) поведение.
 */
export async function buildRowLevelClaim(
  runId: string,
  wbTxs: CanonicalTransaction[],
  lossKopeks: bigint,
): Promise<RowLevelClaimResult | null> {
  if (lossKopeks <= BigInt(0)) return null; // претензия имеет смысл только при недоплате

  try {
    let candidates = await findCandidatesByRunId(runId);

    // Shadow-прогон в reconcile.ts запускается fire-and-forget (без await),
    // поэтому к моменту сборки отчёта кандидаты могут быть ещё не готовы.
    // Генерируем их сами — операция идемпотентна за счёт уникального индекса
    // (run_id, wb_tx_id, bank_tx_id); при гонке с shadow-прогоном просто
    // перечитываем результат вместо падения.
    if (candidates.length === 0) {
      try {
        await generateCandidates(runId);
      } catch (err) {
        console.warn('[claimBuilder] generateCandidates failed (возможна гонка с shadow-прогоном):', err);
      }
      candidates = await findCandidatesByRunId(runId);
    }

    if (candidates.length === 0) return null; // совсем нет данных — откат

    const wbTxIdsWithCandidates = new Set(candidates.map((c) => c.wb_tx_id));

    const wbIn = wbTxs.filter((tx) => ((tx.direction as string) ?? 'IN') !== 'OUT');
    const unmatched = wbIn.filter((tx) => !wbTxIdsWithCandidates.has(tx.id));

    const sumUnmatchedKopeks = unmatched.reduce(
      (s, t) => s + (t.amount_kopeks ?? BigInt(0)),
      BigInt(0),
    );

    // Сверка с уже провалидированным агрегатом
    const diff = sumUnmatchedKopeks > lossKopeks
      ? sumUnmatchedKopeks - lossKopeks
      : lossKopeks - sumUnmatchedKopeks;
    const toleranceKopeks = (lossKopeks * BigInt(TOLERANCE_PERCENT)) / BigInt(100);
    const allowedDiff = toleranceKopeks > TOLERANCE_MIN_KOPEKS ? toleranceKopeks : TOLERANCE_MIN_KOPEKS;

    const confidence: 'high' | 'low' = diff <= allowedDiff ? 'high' : 'low';

    const rows: RowLevelClaimRow[] = unmatched
      .sort((a, b) => timeOf(a.transaction_date) - timeOf(b.transaction_date))
      .map((tx) => ({
        dateStr: fmtDmy(tx.transaction_date),
        amountKopeks: tx.amount_kopeks ?? BigInt(0),
        reference: tx.reference,
        description: tx.description,
      }));

    return { rows, sumUnmatchedKopeks, confidence };
  } catch (err) {
    console.error('[claimBuilder] buildRowLevelClaim failed, откат на агрегатное поведение:', err);
    return null;
  }
}
