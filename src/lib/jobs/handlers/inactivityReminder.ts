import type { Job } from '@/src/db/repositories/jobs';

export async function handleInactivityReminder(job: Job): Promise<void> {
  // Stub: real implementation will send a Telegram nudge if no reconciliation in 30 days.
  // Idempotency: check last reconciliation timestamp before sending.
  console.log(`[inactivity_reminder] job=${job.id} entity=${job.entity_id}`);
}
