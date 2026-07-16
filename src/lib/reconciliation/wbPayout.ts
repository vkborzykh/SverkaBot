import { findTransactionsByImportId } from '@/src/db/repositories/canonical-transactions';
import { createMatches } from '@/src/db/repositories/reconciliation-matches';
import { createMatchItems } from '@/src/db/repositories/reconciliation-match-items';
import { createEvidence } from '@/src/db/repositories/reconciliation-evidence';
import type { ReconciliationRun } from '@/src/db/repositories/reconciliation-runs';
import { getSetting } from '@/src/lib/settings/settings';
import {
  computeWbPayout,
  DEFAULT_WB_KEYWORDS,
  DEFAULT_TOLERANCE_KOPEKS,
  DEFAULT_TOLERANCE_PCT,
  type WbPayoutResult,
} from '@/src/lib/reconciliation/wbPayoutCore';

export type { WbPayoutResult } from '@/src/lib/reconciliation/wbPayoutCore';
export { computeWbPayout, isWbCredit } from '@/src/lib/reconciliation/wbPayoutCore';

/**
 * Report-level WB reconciliation: aggregate the WB net payout and compare it to
 * the sum of bank credits identified as Wildberries. Persists a single match
 * group (+ items + evidence) and returns the metrics for the run.
 */
export async function reconcileWbPayout(run: ReconciliationRun): Promise<WbPayoutResult> {
  const [wbTxs, bankTxs] = await Promise.all([
    findTransactionsByImportId(run.wb_import_id),
    findTransactionsByImportId(run.bank_import_id),
  ]);

  const keywords =
    (await getSetting<string[]>('wb_counterparty_keywords')) ?? DEFAULT_WB_KEYWORDS;
  const toleranceKopeks = BigInt(
    (await getSetting<number>('wb_amount_tolerance_kopeks')) ?? DEFAULT_TOLERANCE_KOPEKS,
  );
  const tolerancePct =
    (await getSetting<number>('wb_amount_tolerance_pct')) ?? DEFAULT_TOLERANCE_PCT;

  const result = computeWbPayout(wbTxs, bankTxs, { keywords, toleranceKopeks, tolerancePct });

  const [match] = await createMatches([
    {
      run_id: run.id,
      match_type: result.matchType,
      final_score: result.finalScore.toFixed(4),
    },
  ]);

  const items = [
    ...result.bankCreditTxIds.map((id) => ({
      match_id: match.id,
      transaction_id: id,
      side: 'BANK' as const,
    })),
    ...result.wbPayoutTxIds.map((id) => ({
      match_id: match.id,
      transaction_id: id,
      side: 'WB' as const,
    })),
  ];
  const CHUNK = 500;
  for (let i = 0; i < items.length; i += CHUNK) {
    await createMatchItems(items.slice(i, i + CHUNK));
  }

  // Передаём объект напрямую – drizzle сам вызовет JSON.stringify один раз.
  // Раньше здесь был явный JSON.stringify, что приводило к двойной сериализации.
  await createEvidence({
    match_id: match.id,
    amount_score: result.finalScore.toFixed(4),
    date_score: '0.0000',
    reference_score: '0.0000',
    description_score: '0.0000',
    counterparty_score: '0.0000',
    penalties: {
      strategy: 'wb_net_payout',
      status: result.status,
      expected_net_kopeks: String(result.expectedNetKopeks),
      wb_in_kopeks: String(result.wbInKopeks),
      wb_out_kopeks: String(result.wbOutKopeks),
      received_kopeks: String(result.receivedKopeks),
      discrepancy_kopeks: String(result.discrepancyKopeks),
      bank_credit_count: result.bankCreditCount,
    },
  });

  return result;
}
