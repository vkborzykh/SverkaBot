// DB → BullMQ poller. Runs on the always-on backend (Oracle VM).
//
// Producers (Vercel) only insert PENDING rows into the `jobs` table; they never
// touch Redis (private to the VM). This poller is the bridge: every
// POLL_INTERVAL_MS it pushes PENDING rows into BullMQ, using the DB job id as
// the BullMQ jobId so duplicate pushes are no-ops (BullMQ dedup). It also
// rescues jobs stuck in RUNNING (e.g. after a crash) back to PENDING.

import { sql } from 'drizzle-orm';
import { getDb } from '@/src/db/index';
import { jobs } from '@/src/db/schema';
import { addBullJob } from './queue';
import type { JobType } from '../queue';

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? '3000');
const BATCH = Number(process.env.POLL_BATCH ?? '50');
const STUCK_MINUTES = Number(process.env.STUCK_JOB_MINUTES ?? '10');

let _timer: NodeJS.Timeout | undefined;
let _busy = false;

async function rescueStuckJobs(): Promise<void> {
  const db = getDb();
  // RUNNING longer than STUCK_MINUTES → reset to PENDING so it's re-pushed.
  // Safe: handlers are idempotent (row_hash dedup) and the worker skips DONE.
  await db.execute(sql`
    UPDATE jobs
    SET status = 'PENDING'
    WHERE status = 'RUNNING'
      AND started_at < NOW() - make_interval(mins => ${STUCK_MINUTES})
  `);
}

async function pollOnce(): Promise<number> {
  const db = getDb();
  const pending = await db
    .select({
      id: jobs.id,
      job_type: jobs.job_type,
      entity_id: jobs.entity_id,
      correlation_id: jobs.correlation_id,
    })
    .from(jobs)
    .where(sql`${jobs.status} = 'PENDING'`)
    .orderBy(jobs.created_at)
    .limit(BATCH);

  for (const row of pending) {
    await addBullJob(
      {
        dbJobId: row.id,
        jobType: row.job_type as JobType,
        entityId: row.entity_id ?? '',
        correlationId: row.correlation_id,
      },
      { jobId: row.id }, // dedup: re-adding the same PENDING row is a no-op
    );
  }
  return pending.length;
}

export function startPoller(): void {
  if (_timer) return;
  console.log(`[poller] starting, interval=${POLL_INTERVAL_MS}ms batch=${BATCH}`);

  const tick = async (): Promise<void> => {
    if (_busy) return; // never overlap ticks
    _busy = true;
    try {
      await rescueStuckJobs();
      const n = await pollOnce();
      if (n > 0) console.log(`[poller] pushed ${n} job(s) to Bull`);
    } catch (err) {
      console.error('[poller] tick error:', err instanceof Error ? err.message : err);
    } finally {
      _busy = false;
    }
  };

  _timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
  void tick(); // run immediately
}

export function stopPoller(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = undefined;
  }
}
