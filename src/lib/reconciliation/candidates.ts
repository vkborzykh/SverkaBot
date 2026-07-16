import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findTransactionsByImportId } from '@/src/db/repositories/canonical-transactions';
import {
  createCandidates,
  findCandidatesByRunId,
  updateCandidateScore,
  type NewReconciliationCandidate,
} from '@/src/db/repositories/reconciliation-candidates';
import { getSetting } from '@/src/lib/settings/settings';
import {
  scoreCandidate,
  type ScoringWeights,
  DEFAULT_WEIGHTS,
} from '@/src/lib/reconciliation/scoring';

const CANDIDATE_CHUNK = 500;

// ── Generate candidates ───────────────────────────────────────────────────────

export async function generateCandidates(runId: string): Promise<number> {
  const run = await findRunById(runId);
  if (!run) throw new Error(`Reconciliation run not found: ${runId}`);

  const dateWindowDays =
    (await getSetting<number>('date_window_days')) ?? DEFAULT_WEIGHTS.date_window_days;

  // Fetch both sides
  const [wbTxs, bankTxs] = await Promise.all([
    findTransactionsByImportId(run.wb_import_id),
    findTransactionsByImportId(run.bank_import_id),
  ]);

  // Index bank transactions by amount_kopeks for O(1) lookup
  // Map<amount_kopeks_string, BankTx[]>
  type BankTx = (typeof bankTxs)[number];
  const bankByAmount = new Map<string, BankTx[]>();
  for (const btx of bankTxs) {
    if (btx.direction !== 'IN') continue;
    if ((btx.currency ?? 'RUB') !== 'RUB') continue;
    const key = String(btx.amount_kopeks);
    const bucket = bankByAmount.get(key);
    if (bucket) {
      bucket.push(btx);
    } else {
      bankByAmount.set(key, [btx]);
    }
  }

  const candidates: NewReconciliationCandidate[] = [];
  const windowMs = dateWindowDays * 86_400_000;

  for (const wbTx of wbTxs) {
    if (wbTx.direction !== 'IN') continue;
    if ((wbTx.currency ?? 'RUB') !== 'RUB') continue;

    const amountKey = String(wbTx.amount_kopeks);
    const matches = bankByAmount.get(amountKey);
    if (!matches || matches.length === 0) continue;

    const wbTime = wbTx.transaction_date ? new Date(wbTx.transaction_date).getTime() : null;
    if (wbTime === null) continue;

    for (const btx of matches) {
      const bankTime = btx.transaction_date ? new Date(btx.transaction_date).getTime() : null;
      if (bankTime === null) continue;

      const diffMs = Math.abs(wbTime - bankTime);
      if (diffMs > windowMs) continue;

      candidates.push({
        run_id: runId,
        wb_tx_id: wbTx.id,
        bank_tx_id: btx.id,
        score: null,
        reason_codes: null,
      });
    }
  }

  // Batch insert
  for (let i = 0; i < candidates.length; i += CANDIDATE_CHUNK) {
    await createCandidates(candidates.slice(i, i + CANDIDATE_CHUNK));
  }

  return candidates.length;
}

// ── Score all candidates for a run ───────────────────────────────────────────

export async function updateCandidateScores(runId: string): Promise<void> {
  const candidates = await findCandidatesByRunId(runId);
  if (candidates.length === 0) return;

  // Load weights from settings (fallback to defaults)
  const weights: ScoringWeights = {
    amount_weight:
      (await getSetting<number>('recon_weight_amount')) ?? DEFAULT_WEIGHTS.amount_weight,
    date_weight:
      (await getSetting<number>('recon_weight_date')) ?? DEFAULT_WEIGHTS.date_weight,
    reference_weight:
      (await getSetting<number>('recon_weight_reference')) ?? DEFAULT_WEIGHTS.reference_weight,
    description_weight:
      (await getSetting<number>('recon_weight_description')) ?? DEFAULT_WEIGHTS.description_weight,
    counterparty_weight:
      (await getSetting<number>('recon_weight_counterparty')) ??
      DEFAULT_WEIGHTS.counterparty_weight,
    date_window_days:
      (await getSetting<number>('date_window_days')) ?? DEFAULT_WEIGHTS.date_window_days,
    penalty_factor:
      (await getSetting<number>('recon_penalty_factor')) ?? DEFAULT_WEIGHTS.penalty_factor,
  };

  // Build a lookup of all transaction ids referenced by candidates
  const txIdSet = new Set<string>();
  for (const c of candidates) {
    txIdSet.add(c.wb_tx_id);
    txIdSet.add(c.bank_tx_id);
  }

  // Fetch the run to get both import ids
  const run = await findRunById(candidates[0].run_id);
  if (!run) throw new Error(`Run not found: ${candidates[0].run_id}`);

  const [wbTxs, bankTxs] = await Promise.all([
    findTransactionsByImportId(run.wb_import_id),
    findTransactionsByImportId(run.bank_import_id),
  ]);

  const txById = new Map<string, (typeof wbTxs)[number]>();
  for (const tx of [...wbTxs, ...bankTxs]) txById.set(tx.id, tx);

  for (const candidate of candidates) {
    const wbTx = txById.get(candidate.wb_tx_id);
    const bankTx = txById.get(candidate.bank_tx_id);
    if (!wbTx || !bankTx) continue;

    const result = scoreCandidate(
      {
        amount_kopeks: wbTx.amount_kopeks ?? BigInt(0),
        transaction_date: wbTx.transaction_date
          ? new Date(wbTx.transaction_date)
          : new Date(),
        direction: (wbTx.direction as 'IN' | 'OUT') ?? 'IN',
        currency: wbTx.currency,
        reference: wbTx.reference,
        description: wbTx.description,
        counterparty: wbTx.counterparty,
      },
      {
        amount_kopeks: bankTx.amount_kopeks ?? BigInt(0),
        transaction_date: bankTx.transaction_date
          ? new Date(bankTx.transaction_date)
          : new Date(),
        direction: (bankTx.direction as 'IN' | 'OUT') ?? 'IN',
        currency: bankTx.currency,
        reference: bankTx.reference,
        description: bankTx.description,
        counterparty: bankTx.counterparty,
      },
      weights,
    );

    await updateCandidateScore(candidate.id, result.score, result.reasonCodes);
  }
}
