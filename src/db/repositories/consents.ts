import { eq } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { consents } from '../schema';

export type Consent = InferSelectModel<typeof consents>;
export type NewConsent = InferInsertModel<typeof consents>;

export async function createConsent(data: NewConsent): Promise<Consent> {
  const db = getDb();
  const rows = await db.insert(consents).values(data).returning();
  return rows[0];
}

export async function findConsentsByUserId(userId: string): Promise<Consent[]> {
  const db = getDb();
  return db.select().from(consents).where(eq(consents.user_id, userId));
}
