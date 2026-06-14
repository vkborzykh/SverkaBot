import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { updateJob } from '@/src/db/repositories/jobs';
import type { Job } from '@/src/db/repositories/jobs';
import { getDb } from '@/src/db/index';
import { jobs } from '@/src/db/schema';
import { handleParseWb } from '@/src/lib/jobs/handlers/parseWb';
import { handleParseBank } from '@/src/lib/jobs/handlers/parseBank';
import { handleReconcile } from '@/src/lib/jobs/handlers/reconcile';
import { handleReportExport } from '@/src/lib/jobs/handlers/reportExport';
import { handleSubscriptionReminder } from '@/src/lib/jobs/handlers/subscriptionReminder';
import { handleInactivityReminder } from '@/src/lib/jobs/handlers/inactivityReminder';
import { handleFileCleanup } from '@/src/lib/jobs/handlers/fileCleanup';

const BATCH_SIZE = 3;
const MAX_RETRIES = 3;

type JobPayload = Record<string, unknown> & { next_attempt_at?: string };

function backoffMs(retries: number): number {
  // 30s, 120s, 480s
  return 30_000 * Math.pow(4, retries);
}

async function claimPendingJobs(): Promise<Job[]> {
  const db = getDb();
  // FOR UPDATE SKIP LOCKED ensures safe concurrent claim in serverless
  const rows = await db.execute(sql`
    UPDATE jobs
    SET status = 'RUNNING', started_at = NOW()
    WHERE id IN (
      SELECT id FROM jobs
      WHERE status = 'PENDING'
        AND (
          payload->>'next_attempt_at' IS NULL
          OR (payload->>'next_attempt_at')::timestamptz <= NOW()
        )
      ORDER BY created_at ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);
  return rows as unknown as Job[];
}

async function dispatch(job: Job): Promise<void> {
  switch (job.job_type) {
    case 'parse_wb':
      return handleParseWb(job);
    case 'parse_bank':
      return handleParseBank(job);
    case 'reconcile':
      return handleReconcile(job);
    case 'report_export':
      return handleReportExport(job);
    case 'subscription_reminder':
      return handleSubscriptionReminder(job);
    case 'inactivity_reminder':
      return handleInactivityReminder(job);
    case 'file_cleanup':
      return handleFileCleanup(job);
    default:
      throw new Error(`Unknown job type: ${job.job_type}`);
  }
}

export async function POST(req: NextRequest) {
  const guard = requireInternalToken(req);
  if (guard) return guard;

  let claimed: Job[];
  try {
    claimed = await claimPendingJobs();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errResponse('DB_ERROR', msg, 500);
  }

  const results: Array<{ id: string; status: string }> = [];

  await Promise.all(
    claimed.map(async (job) => {
      try {
        await dispatch(job);
        await updateJob(job.id, {
          status: 'DONE',
          completed_at: new Date(),
          last_error: null,
        });
        results.push({ id: job.id, status: 'DONE' });
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
          results.push({ id: job.id, status: 'FAILED' });
        } else {
          const nextAttemptAt = new Date(Date.now() + backoffMs(currentRetries));
          const existingPayload = (job.payload as JobPayload | null) ?? {};
          await updateJob(job.id, {
            status: 'PENDING',
            retries: currentRetries,
            last_error: message,
            payload: { ...existingPayload, next_attempt_at: nextAttemptAt.toISOString() },
          });
          results.push({ id: job.id, status: 'PENDING' });
        }
      }
    }),
  );

  return okResponse({ processed: results.length, jobs: results });
}
