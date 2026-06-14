// Reconciliation engine stubs.
// Implements sections 7.2–7.6 of Tech Plan v4.2.

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

export async function generateCandidates(_runId: string): Promise<number> {
  throw new Error('Not implemented');
}

export async function scoreCandidates(_runId: string): Promise<void> {
  throw new Error('Not implemented');
}

export async function globalMatch(_runId: string): Promise<MatchStats> {
  throw new Error('Not implemented');
}
