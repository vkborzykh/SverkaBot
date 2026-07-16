import { eq, and, desc, inArray } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { reconciliation_runs } from '../schema';

export type ReconciliationRun = InferSelectModel<typeof reconciliation_runs>;
export type NewReconciliationRun = InferInsertModel<typeof reconciliation_runs>;

export async function findRunById(
  id: string,
): Promise<ReconciliationRun | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(reconciliation_runs)
    .where(eq(reconciliation_runs.id, id))
    .limit(1);
  return rows[0];
}

export async function findRunsByUserId(
  userId: string,
  limit = 10,
): Promise<ReconciliationRun[]> {
  const db = getDb();
  return db
    .select()
    .from(reconciliation_runs)
    .where(eq(reconciliation_runs.user_id, userId))
    .orderBy(desc(reconciliation_runs.created_at))
    .limit(limit);
}

export async function createRun(
  data: NewReconciliationRun,
): Promise<ReconciliationRun> {
  const db = getDb();
  const rows = await db.insert(reconciliation_runs).values(data).returning();
  return rows[0];
}

export async function updateRun(
  id: string,
  data: Partial<Omit<NewReconciliationRun, 'id' | 'created_at'>>,
): Promise<ReconciliationRun | undefined> {
  const db = getDb();
  const rows = await db
    .update(reconciliation_runs)
    .set(data)
    .where(eq(reconciliation_runs.id, id))
    .returning();
  return rows[0];
}

export async function deleteRunsByUserId(userId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(reconciliation_runs)
    .where(eq(reconciliation_runs.user_id, userId));
}
