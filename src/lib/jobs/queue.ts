// src/lib/jobs/queue.ts
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
  priority?: number,
): Promise<string> {
  const job = await createJob({
    job_type: jobType,
    entity_id: entityId,
    correlation_id: correlationId ?? null,
    status: 'PENDING',
    retries: 0,
    payload,
    priority: priority ?? 100,
  });
  return job.id;
}
