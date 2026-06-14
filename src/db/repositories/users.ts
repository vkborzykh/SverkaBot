import { eq, and, isNull, or, lte, gte } from 'drizzle-orm';
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

export async function findUsersExpiringWithinDays(days: number): Promise<User[]> {
  const db = getDb();
  const now = new Date();
  const threshold = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  return db
    .select()
    .from(users)
    .where(
      and(
        isNull(users.deleted_at),
        or(
          and(
            eq(users.subscription_status, 'TRIAL'),
            gte(users.trial_expires_at, now),
            lte(users.trial_expires_at, threshold),
          ),
          and(
            eq(users.subscription_status, 'ACTIVE'),
            gte(users.subscription_end_date, now),
            lte(users.subscription_end_date, threshold),
          ),
        ),
      ),
    );
}

export async function findExpiredTrialUsers(): Promise<User[]> {
  const db = getDb();
  const now = new Date();

  return db
    .select()
    .from(users)
    .where(
      and(
        isNull(users.deleted_at),
        eq(users.subscription_status, 'TRIAL'),
        lte(users.trial_expires_at, now),
      ),
    );
}

export async function findActiveUsersWithTelegramId(): Promise<User[]> {
  const db = getDb();
  return db
    .select()
    .from(users)
    .where(
      and(
        isNull(users.deleted_at),
        eq(users.subscription_status, 'ACTIVE'),
      ),
    );
}
