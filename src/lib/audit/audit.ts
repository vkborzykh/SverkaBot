import { createAuditEvent } from '@/src/db/repositories/audit-events';

export type AuditEventType =
  | 'consent_accepted'
  | 'trial_started'
  | 'trial_denied_reused'
  | 'subscription_activated'
  | 'subscription_expired'
  | 'data_deleted'
  | 'profile_activated'
  | 'profile_deprecated'
  | 'import_cancelled'
  | 'import_retried'
  | 'run_cancelled';

export async function logAuditEvent(
  userId: string | null,
  eventType: AuditEventType,
  meta?: Record<string, unknown>,
): Promise<void> {
  await createAuditEvent({
    user_id: userId,
    event_type: eventType,
    new_state: meta ?? null,
  });
}
