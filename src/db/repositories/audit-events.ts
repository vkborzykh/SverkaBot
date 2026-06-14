import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { getDb } from '../index';
import { audit_events } from '../schema';

export type AuditEvent = InferSelectModel<typeof audit_events>;
export type NewAuditEvent = InferInsertModel<typeof audit_events>;

export async function createAuditEvent(
  data: NewAuditEvent,
): Promise<AuditEvent> {
  const db = getDb();
  const rows = await db.insert(audit_events).values(data).returning();
  return rows[0];
}
