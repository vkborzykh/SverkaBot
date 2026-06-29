import { Worker, type Job as BullJob } from 'bullmq';
import { getRedisConnection } from './connection';
import { QUEUE_NAME, type BullJobData } from './queue';
import { dispatch } from '../dispatch';
import { notifyFailure } from '../notify';
import { findJobById, updateJob } from '@/src/db/repositories/jobs';
import { alertWorkerFailure } from '@/src/lib/admin/alerts';

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? '3');

export function startWorker(): Worker<BullJobData> {
  const worker = new Worker<BullJobData>(
    QUEUE_NAME,
    async (bullJob: BullJob<BullJobData>) => {
      const { dbJobId } = bullJob.data;

      const job = await findJobById(dbJobId);
      if (!job) {
        // Liveness probe & stale jobs land here — fail fast, no side effects.
        throw new Error(`DB job ${dbJobId} not found`);
      }

      // Idempotency: never re-run a job that already completed.
      if (job.status === 'DONE') {
        console.log(`[worker] job ${dbJobId} already DONE, skipping`);
        return;
      }

      await updateJob(dbJobId, { status: 'RUNNING', started_at: new Date() });
      console.log(`[worker] dispatching ${job.job_type} (db ${dbJobId})`);

      await dispatch(job);

      await updateJob(dbJobId, {
        status: 'DONE',
        completed_at: new Date(),
        last_error: null,
      });
      console.log(`[worker] job ${dbJobId} done`);
    },
    { connection: getRedisConnection(), concurrency: CONCURRENCY },
  );

  worker.on('failed', async (bullJob, err) => {
    if (!bullJob) {
      console.error('[worker] job failed (no ref):', err.message);
      return;
    }
    const { dbJobId } = bullJob.data;
    const attemptsMade = bullJob.attemptsMade ?? 0;
    const maxAttempts = bullJob.opts.attempts ?? 1;
    const isFinal = attemptsMade >= maxAttempts;

    console.error(
      `[worker] bull job ${bullJob.id} failed (attempt ${attemptsMade}/${maxAttempts}): ${err.message}`,
    );

    try {
      await updateJob(dbJobId, {
        status: isFinal ? 'FAILED' : 'PENDING',
        retries: attemptsMade,
        last_error: err.message,
        ...(isFinal ? { completed_at: new Date() } : {}),
      });
    } catch (e) {
      console.error('[worker] failed to update job row:', e);
    }

    if (isFinal) {
      const job = await findJobById(dbJobId);
      if (job) {
        await notifyFailure(job);
        await alertWorkerFailure(job, err.message);   // ← Админ-алерт при финальной ошибке
      }
    }
  });

  worker.on('error', (err) => console.error('[worker] error:', err.message));

  return worker;
}
