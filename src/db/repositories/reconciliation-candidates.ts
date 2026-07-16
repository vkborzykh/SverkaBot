import { eq } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { reconciliation_candidates } from '../schema';

export type ReconciliationCandidate = InferSelectModel<
  typeof reconciliation_candidates
>;
export type NewReconciliationCandidate = InferInsertModel<
  typeof reconciliation_candidates
>;

export async function findCandidatesByRunId(
  runId: string,
): Promise<ReconciliationCandidate[]> {
  const db = getDb();
  return db
    .select()
    .from(reconciliation_candidates)
    .where(eq(reconciliation_candidates.run_id, runId))
    .orderBy(reconciliation_candidates.score);
}

export async function createCandidates(
  data: NewReconciliationCandidate[],
): Promise<ReconciliationCandidate[]> {
  if (data.length === 0) return [];
  const db = getDb();
  return db.insert(reconciliation_candidates).values(data).returning();
}

export async function updateCandidateScore(
  id: string,
  score: number,
  reasonCodes: string[],
): Promise<void> {
  const db = getDb();
  await db
    .update(reconciliation_candidates)
    .set({ score: score.toFixed(4), reason_codes: reasonCodes })
    .where(eq(reconciliation_candidates.id, id));
}
