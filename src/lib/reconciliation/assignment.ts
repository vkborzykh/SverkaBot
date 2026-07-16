import { findCandidatesByRunId } from '@/src/db/repositories/reconciliation-candidates';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findTransactionsByImportId } from '@/src/db/repositories/canonical-transactions';
import {
  createMatches,
  type NewReconciliationMatch,
} from '@/src/db/repositories/reconciliation-matches';
import {
  createMatchItems,
  type NewReconciliationMatchItem,
} from '@/src/db/repositories/reconciliation-match-items';
import { storeEvidence } from '@/src/lib/reconciliation/evidence';
import {
  scoreCandidate,
  DEFAULT_WEIGHTS,
  type ScoringWeights,
  type TxFields,
} from '@/src/lib/reconciliation/scoring';
import { getSetting } from '@/src/lib/settings/settings';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MatchStats {
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
  splitCount: number;
  combinedCount: number;
  matchRate: number;
  unmatchedAmount: bigint;
  ambiguousAmount: bigint;
}

type TxRow = {
  id: string;
  amount_kopeks: bigint | null;
  transaction_date: Date | string | null;
  direction: string | null;
  currency: string | null;
  reference: string | null;
  description: string | null;
  counterparty: string | null;
};

interface Candidate {
  id: string;
  wb_tx_id: string;
  bank_tx_id: string;
  score: number;
  reason_codes: string[];
}

type MatchType = 'MATCHED' | 'AMBIGUOUS' | 'UNMATCHED' | 'SPLIT_MATCHED' | 'COMBINED_MATCHED';

// ── Helpers ───────────────────────────────────────────────────────────────────

function toTxFields(tx: TxRow): TxFields {
  return {
    amount_kopeks: tx.amount_kopeks ?? BigInt(0),
    transaction_date: tx.transaction_date
      ? new Date(tx.transaction_date as string)
      : new Date(0),
    direction: (tx.direction as 'IN' | 'OUT') ?? 'IN',
    currency: tx.currency,
    reference: tx.reference,
    description: tx.description,
    counterparty: tx.counterparty,
  };
}

/**
 * Find connected components in a bipartite graph.
 * wbIds and bankIds are sets; edges connect wb→bank via candidate list.
 * Returns list of components, each a { wbIds: Set, bankIds: Set, edges: Candidate[] }.
 */
function findComponents(candidates: Candidate[]): Array<{
  wbIds: Set<string>;
  bankIds: Set<string>;
  edges: Candidate[];
}> {
  // Build adjacency maps
  const wbToBank = new Map<string, Set<string>>();
  const bankToWb = new Map<string, Set<string>>();
  const edgeMap = new Map<string, Candidate>(); // key = wb_tx_id + '|' + bank_tx_id

  for (const c of candidates) {
    if (!wbToBank.has(c.wb_tx_id)) wbToBank.set(c.wb_tx_id, new Set());
    wbToBank.get(c.wb_tx_id)!.add(c.bank_tx_id);

    if (!bankToWb.has(c.bank_tx_id)) bankToWb.set(c.bank_tx_id, new Set());
    bankToWb.get(c.bank_tx_id)!.add(c.wb_tx_id);

    edgeMap.set(`${c.wb_tx_id}|${c.bank_tx_id}`, c);
  }

  const visitedWb = new Set<string>();
  const visitedBank = new Set<string>();
  const components: Array<{ wbIds: Set<string>; bankIds: Set<string>; edges: Candidate[] }> = [];

  const allWbIds = Array.from(wbToBank.keys());

  for (const startWb of allWbIds) {
    if (visitedWb.has(startWb)) continue;

    const compWb = new Set<string>();
    const compBank = new Set<string>();

    // BFS
    const queueWb: string[] = [startWb];
    while (queueWb.length > 0) {
      const wbId = queueWb.pop()!;
      if (visitedWb.has(wbId)) continue;
      visitedWb.add(wbId);
      compWb.add(wbId);

      const banks = wbToBank.get(wbId) ?? new Set<string>();
      for (const bankId of Array.from(banks)) {
        if (!visitedBank.has(bankId)) {
          visitedBank.add(bankId);
          compBank.add(bankId);
          const wbs = bankToWb.get(bankId) ?? new Set<string>();
          for (const wb of Array.from(wbs)) {
            if (!visitedWb.has(wb)) queueWb.push(wb);
          }
        }
      }
    }

    // Collect edges in this component
    const edges: Candidate[] = [];
    for (const wbId of Array.from(compWb)) {
      for (const bankId of Array.from(wbToBank.get(wbId) ?? new Set())) {
        const edge = edgeMap.get(`${wbId}|${bankId}`);
        if (edge) edges.push(edge);
      }
    }

    components.push({ wbIds: compWb, bankIds: compBank, edges });
  }

  return components;
}

/**
 * Brute-force maximum-weight bipartite matching for small components.
 * Returns array of (wb_tx_id, bank_tx_id, score) assignments maximizing total score.
 * Uses recursive permutation over the smaller side.
 */
function bruteForceMatch(
  wbIds: string[],
  bankIds: string[],
  scoreMap: Map<string, number>,
): Array<{ wbId: string; bankId: string; score: number }> {
  let bestScore = -1;
  let bestAssignment: Array<{ wbId: string; bankId: string; score: number }> = [];

  function recurse(
    wbIdx: number,
    usedBankIds: Set<string>,
    current: Array<{ wbId: string; bankId: string; score: number }>,
    currentScore: number,
  ) {
    if (wbIdx === wbIds.length) {
      if (currentScore > bestScore) {
        bestScore = currentScore;
        bestAssignment = [...current];
      }
      return;
    }

    const wbId = wbIds[wbIdx];

    // Option: skip this WB (leave unmatched)
    recurse(wbIdx + 1, usedBankIds, current, currentScore);

    // Option: assign to each available bank
    for (const bankId of bankIds) {
      if (usedBankIds.has(bankId)) continue;
      const score = scoreMap.get(`${wbId}|${bankId}`) ?? 0;
      if (score === 0) continue;

      usedBankIds.add(bankId);
      current.push({ wbId, bankId, score });
      recurse(wbIdx + 1, usedBankIds, current, currentScore + score);
      current.pop();
      usedBankIds.delete(bankId);
    }
  }

  recurse(0, new Set(), [], 0);
  return bestAssignment;
}

/**
 * Greedy matching for large components: sort edges desc by score, assign if both free.
 */
function greedyMatch(
  edges: Candidate[],
): Array<{ wbId: string; bankId: string; score: number }> {
  const sorted = [...edges].sort((a, b) => b.score - a.score);
  const usedWb = new Set<string>();
  const usedBank = new Set<string>();
  const result: Array<{ wbId: string; bankId: string; score: number }> = [];

  for (const e of sorted) {
    if (usedWb.has(e.wb_tx_id) || usedBank.has(e.bank_tx_id)) continue;
    usedWb.add(e.wb_tx_id);
    usedBank.add(e.bank_tx_id);
    result.push({ wbId: e.wb_tx_id, bankId: e.bank_tx_id, score: e.score });
  }

  return result;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function globalMatch(
  runId: string,
  opts?: { dryRun?: boolean },
): Promise<MatchStats> {
  const run = await findRunById(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);

  const rawCandidates = await findCandidatesByRunId(runId);

  // Only consider candidates with a score
  const candidates: Candidate[] = rawCandidates
    .filter((c) => c.score !== null)
    .map((c) => ({
      id: c.id,
      wb_tx_id: c.wb_tx_id,
      bank_tx_id: c.bank_tx_id,
      score: parseFloat(String(c.score)),
      reason_codes: (c.reason_codes as string[]) ?? [],
    }));

  if (candidates.length === 0) {
    // Everything is unmatched
    const [wbTxs] = await Promise.all([
      findTransactionsByImportId(run.wb_import_id),
    ]);
    const unmatchedAmount = wbTxs.reduce(
      (s, tx) => s + (tx.amount_kopeks ?? BigInt(0)),
      BigInt(0),
    );
    return {
      matchedCount: 0,
      unmatchedCount: wbTxs.length,
      ambiguousCount: 0,
      splitCount: 0,
      combinedCount: 0,
      matchRate: 0,
      unmatchedAmount,
      ambiguousAmount: BigInt(0),
    };
  }

  const highConfThreshold =
    (await getSetting<number>('recon_high_confidence_threshold')) ?? 0.9;
  const maxComponentNodes =
    (await getSetting<number>('recon_max_component_nodes')) ?? 8;
  const ambiguousThreshold =
    (await getSetting<number>('recon_ambiguous_threshold')) ?? 0.1;

  const weights: ScoringWeights = {
    amount_weight: (await getSetting<number>('recon_weight_amount')) ?? DEFAULT_WEIGHTS.amount_weight,
    date_weight: (await getSetting<number>('recon_weight_date')) ?? DEFAULT_WEIGHTS.date_weight,
    reference_weight: (await getSetting<number>('recon_weight_reference')) ?? DEFAULT_WEIGHTS.reference_weight,
    description_weight: (await getSetting<number>('recon_weight_description')) ?? DEFAULT_WEIGHTS.description_weight,
    counterparty_weight: (await getSetting<number>('recon_weight_counterparty')) ?? DEFAULT_WEIGHTS.counterparty_weight,
    date_window_days: (await getSetting<number>('date_window_days')) ?? DEFAULT_WEIGHTS.date_window_days,
    penalty_factor: (await getSetting<number>('recon_penalty_factor')) ?? DEFAULT_WEIGHTS.penalty_factor,
  };

  // Load all transactions for evidence
  const [wbTxs, bankTxs] = await Promise.all([
    findTransactionsByImportId(run.wb_import_id),
    findTransactionsByImportId(run.bank_import_id),
  ]);
  const txById = new Map<string, TxRow>();
  for (const tx of [...wbTxs, ...bankTxs]) txById.set(tx.id, tx as TxRow);

  const allWbIds = new Set(wbTxs.map((t) => t.id));

  // Track assignment outcomes
  const matchedWb = new Set<string>();
  const matchedBank = new Set<string>();
  const ambiguousWb = new Set<string>();

  const matchRows: NewReconciliationMatch[] = [];
  const matchItemPairs: Array<{ items: NewReconciliationMatchItem[]; matchIdx: number }> = [];
  const evidenceQueue: Array<{ matchIdx: number; wbTx: TxRow; bankTx: TxRow; candidate: Candidate }> = [];

  // ── Step 1: High-confidence unique matches ───────────────────────────────

  // Count candidates per WB and per bank
  const wbCandidateCount = new Map<string, number>();
  const bankCandidateCount = new Map<string, number>();
  for (const c of candidates) {
    wbCandidateCount.set(c.wb_tx_id, (wbCandidateCount.get(c.wb_tx_id) ?? 0) + 1);
    bankCandidateCount.set(c.bank_tx_id, (bankCandidateCount.get(c.bank_tx_id) ?? 0) + 1);
  }

  const remainingCandidates: Candidate[] = [];

  for (const c of candidates) {
    if (
      c.score >= highConfThreshold &&
      (wbCandidateCount.get(c.wb_tx_id) ?? 0) === 1 &&
      (bankCandidateCount.get(c.bank_tx_id) ?? 0) === 1 &&
      !matchedWb.has(c.wb_tx_id) &&
      !matchedBank.has(c.bank_tx_id)
    ) {
      matchedWb.add(c.wb_tx_id);
      matchedBank.add(c.bank_tx_id);

      const matchIdx = matchRows.length;
      matchRows.push({ run_id: runId, match_type: 'MATCHED', final_score: c.score.toFixed(4) });
      matchItemPairs.push({
        matchIdx,
        items: [
          { match_id: '', transaction_id: c.wb_tx_id, side: 'WB' },
          { match_id: '', transaction_id: c.bank_tx_id, side: 'BANK' },
        ],
      });

      const wbTx = txById.get(c.wb_tx_id);
      const bankTx = txById.get(c.bank_tx_id);
      if (wbTx && bankTx) {
        evidenceQueue.push({ matchIdx, wbTx, bankTx, candidate: c });
      }
    } else {
      remainingCandidates.push(c);
    }
  }

  // ── Step 2: Connected component decomposition ────────────────────────────

  const activeCandidates = remainingCandidates.filter(
    (c) => !matchedWb.has(c.wb_tx_id) && !matchedBank.has(c.bank_tx_id),
  );

  const components = findComponents(activeCandidates);

  for (const comp of components) {
    const compSize = comp.wbIds.size + comp.bankIds.size;
    const wbArr = Array.from(comp.wbIds);
    const bankArr = Array.from(comp.bankIds);

    // Build score map for this component
    const scoreMap = new Map<string, number>();
    for (const e of comp.edges) {
      const existing = scoreMap.get(`${e.wb_tx_id}|${e.bank_tx_id}`);
      if (existing === undefined || e.score > existing) {
        scoreMap.set(`${e.wb_tx_id}|${e.bank_tx_id}`, e.score);
      }
    }

    // Detect ambiguous: all edges have scores within ambiguousThreshold of each other
    let assignments: Array<{ wbId: string; bankId: string; score: number }>;

    if (compSize <= maxComponentNodes) {
      assignments = bruteForceMatch(wbArr, bankArr, scoreMap);
    } else {
      assignments = greedyMatch(comp.edges.filter(
        (c) => !matchedWb.has(c.wb_tx_id) && !matchedBank.has(c.bank_tx_id),
      ));
    }

    // For each WB in component, check for ambiguity (multiple candidates with similar scores)
    for (const wbId of wbArr) {
      if (matchedWb.has(wbId)) continue;

      const wbEdges = comp.edges.filter((e) => e.wb_tx_id === wbId);
      if (wbEdges.length === 0) continue;

      const maxScore = Math.max(...wbEdges.map((e) => e.score));
      const closeEnough = wbEdges.filter(
        (e) => maxScore - e.score <= ambiguousThreshold && e.score > 0,
      );

      // Ambiguous: 2+ candidates within ambiguousThreshold and none was assigned
      const assigned = assignments.find((a) => a.wbId === wbId);
      if (!assigned && closeEnough.length >= 2) {
        ambiguousWb.add(wbId);

        const matchIdx = matchRows.length;
        matchRows.push({
          run_id: runId,
          match_type: 'AMBIGUOUS',
          final_score: maxScore.toFixed(4),
        });
        // Link the top 2 candidates as items
        const items: NewReconciliationMatchItem[] = [
          { match_id: '', transaction_id: wbId, side: 'WB' },
          ...closeEnough.slice(0, 2).map((e) => ({
            match_id: '',
            transaction_id: e.bank_tx_id,
            side: 'BANK' as const,
          })),
        ];
        matchItemPairs.push({ matchIdx, items });

        const topCandidate = closeEnough[0];
        const wbTx = txById.get(wbId);
        const bankTx = txById.get(topCandidate.bank_tx_id);
        if (wbTx && bankTx) {
          evidenceQueue.push({ matchIdx, wbTx, bankTx, candidate: topCandidate });
        }
      }
    }

    for (const a of assignments) {
      if (matchedWb.has(a.wbId) || matchedBank.has(a.bankId)) continue;
      if (ambiguousWb.has(a.wbId)) continue;

      matchedWb.add(a.wbId);
      matchedBank.add(a.bankId);

      const matchIdx = matchRows.length;
      matchRows.push({ run_id: runId, match_type: 'MATCHED', final_score: a.score.toFixed(4) });
      matchItemPairs.push({
        matchIdx,
        items: [
          { match_id: '', transaction_id: a.wbId, side: 'WB' },
          { match_id: '', transaction_id: a.bankId, side: 'BANK' },
        ],
      });

      const candidate = comp.edges.find(
        (e) => e.wb_tx_id === a.wbId && e.bank_tx_id === a.bankId,
      );
      const wbTx = txById.get(a.wbId);
      const bankTx = txById.get(a.bankId);
      if (wbTx && bankTx && candidate) {
        evidenceQueue.push({ matchIdx, wbTx, bankTx, candidate });
      }
    }
  }

  // ── Step 3: Persist matches (skip if dryRun) ──────────────────────────────

  let persistedMatches: { id: string }[] = [];

  if (!opts?.dryRun && matchRows.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < matchRows.length; i += CHUNK) {
      const chunk = await createMatches(matchRows.slice(i, i + CHUNK));
      persistedMatches.push(...chunk);
    }

    // Insert match items with real match IDs
    const allItems: NewReconciliationMatchItem[] = [];
    for (const { matchIdx, items } of matchItemPairs) {
      const matchId = persistedMatches[matchIdx]?.id;
      if (!matchId) continue;
      for (const item of items) {
        allItems.push({ ...item, match_id: matchId });
      }
    }
    if (allItems.length > 0) {
      const CHUNK_ITEMS = 500;
      for (let i = 0; i < allItems.length; i += CHUNK_ITEMS) {
        await createMatchItems(allItems.slice(i, i + CHUNK_ITEMS));
      }
    }

    // Store evidence for matched pairs
    for (const { matchIdx, wbTx, bankTx, candidate } of evidenceQueue) {
      const matchId = persistedMatches[matchIdx]?.id;
      if (!matchId) continue;

      const result = scoreCandidate(toTxFields(wbTx), toTxFields(bankTx), weights);
      await storeEvidence({
        matchId,
        components: result.components,
        penalties: result.penalties,
        finalScore: candidate.score,
      });
    }
  }

  // ── Step 4: Compute stats ────────────────────────────────────────────────

  const matchedCount = matchRows.filter((m) => m.match_type === 'MATCHED').length;
  const ambiguousCount = matchRows.filter((m) => m.match_type === 'AMBIGUOUS').length;
  const unmatchedWbIds = Array.from(allWbIds).filter(
    (id) => !matchedWb.has(id) && !ambiguousWb.has(id),
  );

  const unmatchedAmount = unmatchedWbIds.reduce((s, id) => {
    const tx = txById.get(id);
    return s + (tx?.amount_kopeks ?? BigInt(0));
  }, BigInt(0));

  const ambiguousAmount = Array.from(ambiguousWb).reduce((s, id) => {
    const tx = txById.get(id);
    return s + (tx?.amount_kopeks ?? BigInt(0));
  }, BigInt(0));

  const totalWb = allWbIds.size;
  const matchRate = totalWb > 0 ? (matchedCount / totalWb) * 100 : 0;

  return {
    matchedCount,
    unmatchedCount: unmatchedWbIds.length,
    ambiguousCount,
    splitCount: 0, // set after detectSplitCombined
    combinedCount: 0,
    matchRate,
    unmatchedAmount,
    ambiguousAmount,
  };
}
