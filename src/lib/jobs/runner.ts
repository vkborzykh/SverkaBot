import { sql, inArray, eq, and } from 'drizzle-orm';
import { getDb } from '@/src/db/index';
import { updateJob, type Job } from '@/src/db/repositories/jobs';
import { jobs } from '@/src/db/schema';
import { dispatch } from './dispatch';
import { notifyFailure } from './notify';

const BATCH_SIZE = 3;
const MAX_RETRIES = 3;
const MAX_BATCHES_PER_DRAIN = 10;

type JobPayload = Record<string, unknown> & { next_attempt_at?: string };

function backoffMs(retries: number): number {
  return 30_000 * Math.pow(4, retries);
}

async function claimPendingJobs(): Promise<Job[]> {
  const db = getDb();
  // Выбираем до BATCH_SIZE PENDING-задач, которые готовы к запуску
  const pending = await db
    .select()
    .from(jobs)
    .where(
      sql`${jobs.status} = 'PENDING' AND (
        ${jobs.payload}->>'next_attempt_at' IS NULL OR
        (${jobs.payload}->>'next_attempt_at')::timestamptz <= NOW()
      )`
    )
    .orderBy(jobs.created_at)
    .limit(BATCH_SIZE);

  if (pending.length === 0) return [];

  // Атомарно обновляем только те строки, которые ещё PENDING,
  // и возвращаем обновлённые. Это исключает гонку без FOR UPDATE.
  const ids = pending.map((row) => row.id);
  const updated = await db
    .update(jobs)
    .set({ status: 'RUNNING', started_at: new Date() })
    .where(
      and(
        inArray(jobs.id, ids),
        eq(jobs.status, 'PENDING')   // гарантия, что другой обработчик не взял задачу
      )
    )
    .returning();

  return updated as Job[];
}

async function processBatch(claimed: Job[]): Promise<void> {
  await Promise.all(
    claimed.map(async (job) => {
      try {
        await dispatch(job);
        await updateJob(job.id, {
          status: 'DONE',
          completed_at: new Date(),
          last_error: null,
        });
      } catch (err) {
        const currentRetries = (job.retries ?? 0) + 1;
        const message = err instanceof Error ? err.message : String(err);

        if (currentRetries >= MAX_RETRIES) {
          await updateJob(job.id, {
            status: 'FAILED',
            retries: currentRetries,
            last_error: message,
            completed_at: new Date(),
          });
          await notifyFailure(job);
        } else {
          const nextAttemptAt = new Date(Date.now() + backoffMs(currentRetries));
          const existingPayload = (job.payload as JobPayload | null) ?? {};
          await updateJob(job.id, {
            status: 'PENDING',
            retries: currentRetries,
            last_error: message,
            payload: {
              ...existingPayload,
              next_attempt_at: nextAttemptAt.toISOString(),
            },
          });
        }
      }
    }),
  );
}

export async function drainQueue(): Promise<number> {
  let handled = 0;
  for (let i = 0; i < MAX_BATCHES_PER_DRAIN; i++) {
    const claimed = await claimPendingJobs();
    if (claimed.length === 0) break;
    await processBatch(claimed);
    handled += claimed.length;
  }
  return handled;
}
