import { eq } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { reconciliation_matches } from '../schema';

export type ReconciliationMatch = InferSelectModel<typeof reconciliation_matches>;
export type NewReconciliationMatch = InferInsertModel<
  typeof reconciliation_matches
>;

export async function findMatchesByRunId(
  runId: string,
): Promise<ReconciliationMatch[]> {
  const db = getDb();
  return db
    .select()
    .from(reconciliation_matches)
    .where(eq(reconciliation_matches.run_id, runId));
}

export async function createMatch(
  data: NewReconciliationMatch,
): Promise<ReconciliationMatch> {
  const db = getDb();
  const rows = await db.insert(reconciliation_matches).values(data).returning();
  return rows[0];
}

export async function createMatches(
  data: NewReconciliationMatch[],
): Promise<ReconciliationMatch[]> {
  if (data.length === 0) return [];
  const db = getDb();
  return db.insert(reconciliation_matches).values(data).returning();
}
