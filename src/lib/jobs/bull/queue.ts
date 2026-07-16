// BullMQ queue — the transport layer. The DB `jobs` table stays the source of
// truth; every Bull job carries dbJobId so the worker can load/update the row.

import { Queue, type JobsOptions } from 'bullmq';
import { getRedisConnection } from './connection';
import type { JobType } from '../queue';

export const QUEUE_NAME = 'sverkabot';

export interface BullJobData {
  dbJobId: string; // row id in the `jobs` table (source of truth)
  jobType: JobType;
  entityId: string;
  correlationId?: string | null;
}

let _queue: Queue<BullJobData> | undefined;

export function getQueue(): Queue<BullJobData> {
  if (_queue) return _queue;
  _queue = new Queue<BullJobData>(QUEUE_NAME, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 }, // ~30s, 60s
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return _queue;
}

// jobId is set to the DB job id by the poller so duplicate pushes are no-ops
// (BullMQ deduplicates by jobId while the job exists).
export async function addBullJob(
  data: BullJobData,
  opts?: JobsOptions,
): Promise<void> {
  await getQueue().add(data.jobType, data, opts);
}
