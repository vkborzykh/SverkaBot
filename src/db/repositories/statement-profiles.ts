import { eq, and, isNull } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { statement_profiles, imports } from '../schema';

export type StatementProfile = InferSelectModel<typeof statement_profiles>;
export type NewStatementProfile = InferInsertModel<typeof statement_profiles>;

export async function findProfileById(
  id: string,
): Promise<StatementProfile | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(statement_profiles)
    .where(and(eq(statement_profiles.id, id), isNull(statement_profiles.deleted_at)))
    .limit(1);
  return rows[0];
}

export async function findProfileByKey(
  profileKey: string,
): Promise<StatementProfile | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(statement_profiles)
    .where(
      and(
        eq(statement_profiles.profile_key, profileKey),
        isNull(statement_profiles.deleted_at),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function findActiveProfiles(): Promise<StatementProfile[]> {
  const db = getDb();
  return db
    .select()
    .from(statement_profiles)
    .where(
      and(
        eq(statement_profiles.status, 'ACTIVE'),
        isNull(statement_profiles.deleted_at),
      ),
    );
}

export async function createProfile(
  data: NewStatementProfile,
): Promise<StatementProfile> {
  const db = getDb();
  const rows = await db.insert(statement_profiles).values(data).returning();
  return rows[0];
}

export async function updateProfile(
  id: string,
  data: Partial<Omit<NewStatementProfile, 'id' | 'created_at'>>,
): Promise<StatementProfile | undefined> {
  const db = getDb();
  const rows = await db
    .update(statement_profiles)
    .set(data)
    .where(eq(statement_profiles.id, id))
    .returning();
  return rows[0];
}

export async function softDeleteProfile(
  id: string,
): Promise<StatementProfile | undefined> {
  const db = getDb();
  const rows = await db
    .update(statement_profiles)
    .set({ deleted_at: new Date() })
    .where(eq(statement_profiles.id, id))
    .returning();
  return rows[0];
}

/**
 * Recompute and persist usage_count and success_rate for a profile from all
 * COMPLETED BANK imports that reference it. Called after each successful parse.
 */
export async function updateProfileStats(profileId: string): Promise<void> {
  const db = getDb();

  const completed = await db
    .select({ rate: imports.parse_success_rate })
    .from(imports)
    .where(
      and(
        eq(imports.profile_id, profileId),
        eq(imports.status, 'COMPLETED'),
        isNull(imports.deleted_at),
      ),
    );

  if (completed.length === 0) return;

  const rates = completed
    .map((r) => parseFloat(String(r.rate ?? '0')))
    .filter((n) => !isNaN(n));
  const avgRate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;

  await db
    .update(statement_profiles)
    .set({
      usage_count: completed.length,
      success_rate: avgRate.toFixed(2),
      updated_at: new Date(),
    })
    .where(eq(statement_profiles.id, profileId));
}
