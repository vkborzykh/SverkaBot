import { eq } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { settings } from '../schema';

export type Setting = InferSelectModel<typeof settings>;
export type NewSetting = InferInsertModel<typeof settings>;

export async function findSettingByKey(
  key: string,
): Promise<Setting | undefined> {
  const db = getDb();
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return rows[0];
}

export async function upsertSetting(
  key: string,
  valueJson: unknown,
  description?: string,
): Promise<Setting> {
  const db = getDb();
  const rows = await db
    .insert(settings)
    .values({ key, value_json: valueJson, description })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value_json: valueJson },
    })
    .returning();
  return rows[0];
}

export async function findAllSettings(): Promise<Setting[]> {
  const db = getDb();
  return db.select().from(settings).orderBy(settings.key);
}
