import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { admin_notifications } from '../schema';

export type AdminNotification = InferSelectModel<typeof admin_notifications>;
export type NewAdminNotification = InferInsertModel<typeof admin_notifications>;

export async function createAdminNotification(
  data: NewAdminNotification,
): Promise<AdminNotification> {
  const db = getDb();
  const rows = await db.insert(admin_notifications).values(data).returning();
  return rows[0];
}
