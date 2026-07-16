import { eq } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { reconciliation_match_items } from '../schema';

export type ReconciliationMatchItem = InferSelectModel<
  typeof reconciliation_match_items
>;
export type NewReconciliationMatchItem = InferInsertModel<
  typeof reconciliation_match_items
>;

export async function findMatchItemsByMatchId(
  matchId: string,
): Promise<ReconciliationMatchItem[]> {
  const db = getDb();
  return db
    .select()
    .from(reconciliation_match_items)
    .where(eq(reconciliation_match_items.match_id, matchId));
}

export async function createMatchItems(
  data: NewReconciliationMatchItem[],
): Promise<ReconciliationMatchItem[]> {
  if (data.length === 0) return [];
  const db = getDb();
  return db.insert(reconciliation_match_items).values(data).returning();
}
