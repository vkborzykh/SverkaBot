import { createJob } from '@/src/db/repositories/jobs';
import { drainQueue } from '@/src/lib/jobs/runner';
import { runBackground } from '@/src/lib/jobs/background';

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

  // Process the queue in-process, kept alive past the HTTP response via
  // waitUntil. No self-HTTP call (which was being killed on serverless),
  // and the just-created job runs in the SAME invocation that wrote the
  // upload to local storage — so the parser can read it before /tmp is
  // recycled. The daily cron is the long-tail fallback for retries.
  console.log('[enqueue] triggering drainQueue in background');
  runBackground(drainQueue());

  return job.id;
}
