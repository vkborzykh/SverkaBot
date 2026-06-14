import { eq, inArray } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { canonical_transactions } from '../schema';

export type CanonicalTransaction = InferSelectModel<
  typeof canonical_transactions
>;
export type NewCanonicalTransaction = InferInsertModel<
  typeof canonical_transactions
>;

export async function findTransactionById(
  id: string,
): Promise<CanonicalTransaction | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(canonical_transactions)
    .where(eq(canonical_transactions.id, id))
    .limit(1);
  return rows[0];
}

export async function findTransactionsByImportId(
  importId: string,
): Promise<CanonicalTransaction[]> {
  const db = getDb();
  return db
    .select()
    .from(canonical_transactions)
    .where(eq(canonical_transactions.import_id, importId))
    .orderBy(canonical_transactions.row_number);
}

export async function createTransactions(
  data: NewCanonicalTransaction[],
): Promise<CanonicalTransaction[]> {
  if (data.length === 0) return [];
  const db = getDb();
  return db.insert(canonical_transactions).values(data).returning();
}

export async function deleteTransactionsByImportIds(
  importIds: string[],
): Promise<void> {
  if (importIds.length === 0) return;
  const db = getDb();
  await db
    .delete(canonical_transactions)
    .where(inArray(canonical_transactions.import_id, importIds));
}
