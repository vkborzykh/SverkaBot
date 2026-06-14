import { createJob } from '@/src/db/repositories/jobs';

export type JobType =
  | 'parse_wb'
  | 'parse_bank'
  | 'reconcile'
  | 'report_export'
  | 'subscription_reminder'
  | 'inactivity_reminder'
  | 'file_cleanup';

export async function enqueue(
  jobType: JobType,
  entityId: string,
  payload: Record<string, unknown>,
  correlationId?: string,
): Promise<string> {
  const job = await createJob({
    job_type: jobType,
    entity_id: entityId,
    correlation_id: correlationId ?? null,
    status: 'PENDING',
    retries: 0,
    payload,
  });

  // Fire-and-forget trigger — does not block the caller
  const internalToken = process.env.INTERNAL_TOKEN;
  if (internalToken) {
    const base =
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.VERCEL_URL ??
      'http://localhost:3000';
    const url = `${base.startsWith('http') ? base : `https://${base}`}/api/jobs/process`;
    fetch(url, {
      method: 'POST',
      headers: { 'x-internal-token': internalToken },
    }).catch(() => {
      // intentionally ignored — cron is the fallback
    });
  }

  return job.id;
}
