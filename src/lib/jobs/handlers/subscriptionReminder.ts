import type { Job } from '@/src/db/repositories/jobs';

export async function handleSubscriptionReminder(job: Job): Promise<void> {
  // Stub: real implementation will send a Telegram reminder 3 days before expiry.
  // Idempotency: check user.subscription_status and expiry before sending.
  console.log(`[subscription_reminder] job=${job.id} entity=${job.entity_id}`);
}
