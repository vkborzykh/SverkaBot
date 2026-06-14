import { eq, and, isNull } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { users } from '../schema';

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

export async function findUserById(id: string): Promise<User | undefined> {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function findUserByTelegramId(
  telegramId: bigint,
): Promise<User | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.telegram_id, telegramId))
    .limit(1);
  return rows[0];
}

export async function createUser(data: NewUser): Promise<User> {
  const db = getDb();
  const rows = await db.insert(users).values(data).returning();
  return rows[0];
}

export async function updateUser(
  id: string,
  data: Partial<Omit<NewUser, 'id' | 'created_at'>>,
): Promise<User | undefined> {
  const db = getDb();
  const rows = await db
    .update(users)
    .set(data)
    .where(eq(users.id, id))
    .returning();
  return rows[0];
}

export async function anonymizeUser(id: string): Promise<User | undefined> {
  const db = getDb();
  const rows = await db
    .update(users)
    .set({
      username: null,
      deleted_at: new Date(),
    })
    .where(eq(users.id, id))
    .returning();
  return rows[0];
}
