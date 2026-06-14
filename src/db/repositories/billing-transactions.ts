import { eq } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { billing_transactions } from '../schema';

export type BillingTransaction = InferSelectModel<typeof billing_transactions>;
export type NewBillingTransaction = InferInsertModel<typeof billing_transactions>;

export async function createBillingTransaction(
  data: NewBillingTransaction,
): Promise<BillingTransaction> {
  const db = getDb();
  const rows = await db.insert(billing_transactions).values(data).returning();
  return rows[0];
}

export async function findBillingTransactionsByUserId(
  userId: string,
): Promise<BillingTransaction[]> {
  const db = getDb();
  return db
    .select()
    .from(billing_transactions)
    .where(eq(billing_transactions.user_id, userId))
    .orderBy(billing_transactions.created_at);
}

export async function updateBillingTransaction(
  id: string,
  data: Partial<Omit<NewBillingTransaction, 'id' | 'created_at'>>,
): Promise<BillingTransaction | undefined> {
  const db = getDb();
  const rows = await db
    .update(billing_transactions)
    .set(data)
    .where(eq(billing_transactions.id, id))
    .returning();
  return rows[0];
}
