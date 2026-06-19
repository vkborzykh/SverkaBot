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
  console.log('[enqueue] called with:', { jobType, entityId, payload, correlationId });
  const job = await createJob({
    job_type: jobType,
    entity_id: entityId,
    correlation_id: correlationId ?? null,
    status: 'PENDING',
    retries: 0,
    payload,
  });
  console.log('[enqueue] job created:', job);
  // No immediate background execution — rely on cron-job.org to call /api/jobs/process
  return job.id;
}
