import { createJob } from '@/src/db/repositories/jobs';

export type JobType =
  | 'parse_wb'
  | 'parse_bank'
  | 'reconcile'
  | 'report_export'
  | 'subscription_reminder'
  | 'inactivity_reminder'
  | 'file_cleanup';

// Enqueue a background job.
//
// This ALWAYS inserts a PENDING row into the `jobs` table — PostgreSQL is the
// source of truth (Tech Plan). Execution depends on QUEUE_DRIVER:
//   - 'bull' (production): the always-on worker's DB→Bull poller picks up the
//     PENDING row and pushes it into BullMQ on the backend host. Producers
//     (this code, on Vercel) never touch Redis — Redis stays private to the VM.
//   - 'db'  (legacy/rollback): the Vercel cron route drains the queue in-process.
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
  return job.id;
}
