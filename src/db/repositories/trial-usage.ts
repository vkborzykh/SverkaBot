import { eq } from 'drizzle-orm';
import { getDb } from '../index';
import { trial_usage } from '../schema';

export async function hasUsedTrial(telegramId: bigint): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select()
    .from(trial_usage)
    .where(eq(trial_usage.telegram_id, telegramId))
    .limit(1);
  return rows.length > 0;
}

export async function markTrialUsed(telegramId: bigint): Promise<void> {
  const db = getDb();
  await db.insert(trial_usage).values({ telegram_id: telegramId }).onConflictDoNothing();
}
