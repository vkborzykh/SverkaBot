import { createAuditEvent } from '@/src/db/repositories/audit-events';

export type AuditEventType =
  | 'consent_accepted'
  | 'trial_started'
  | 'subscription_activated'
  | 'subscription_expired'
  | 'data_deleted';

export async function logAuditEvent(
  userId: string,
  eventType: AuditEventType,
  meta?: Record<string, unknown>,
): Promise<void> {
  await createAuditEvent({
    user_id: userId,
    event_type: eventType,
    new_state: meta ?? null,
  });
}
