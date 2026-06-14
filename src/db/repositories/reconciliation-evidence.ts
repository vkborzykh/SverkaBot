import { eq } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { reconciliation_evidence } from '../schema';

export type ReconciliationEvidence = InferSelectModel<
  typeof reconciliation_evidence
>;
export type NewReconciliationEvidence = InferInsertModel<
  typeof reconciliation_evidence
>;

export async function findEvidenceByMatchId(
  matchId: string,
): Promise<ReconciliationEvidence | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(reconciliation_evidence)
    .where(eq(reconciliation_evidence.match_id, matchId))
    .limit(1);
  return rows[0];
}

export async function createEvidence(
  data: NewReconciliationEvidence,
): Promise<ReconciliationEvidence> {
  const db = getDb();
  const rows = await db
    .insert(reconciliation_evidence)
    .values(data)
    .returning();
  return rows[0];
}
