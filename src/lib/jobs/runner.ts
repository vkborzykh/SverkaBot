import { sql } from 'drizzle-orm';
import { getDb } from '@/src/db/index';
import { updateJob, type Job } from '@/src/db/repositories/jobs';
import { findImportById } from '@/src/db/repositories/imports';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findUserById } from '@/src/db/repositories/users';
import { handleParseWb } from '@/src/lib/jobs/handlers/parseWb';
import { handleParseBank } from '@/src/lib/jobs/handlers/parseBank';
import { handleReconcile } from '@/src/lib/jobs/handlers/reconcile';
import { handleReportExport } from '@/src/lib/jobs/handlers/reportExport';
import { handleSubscriptionReminder } from '@/src/lib/jobs/handlers/subscriptionReminder';
import { handleInactivityReminder } from '@/src/lib/jobs/handlers/inactivityReminder';
import { handleFileCleanup } from '@/src/lib/jobs/handlers/fileCleanup';

const BATCH_SIZE = 3;
const MAX_RETRIES = 3;
const MAX_BATCHES_PER_DRAIN = 10;

type JobPayload = Record<string, unknown> & { next_attempt_at?: string };

function backoffMs(retries: number): number {
  return 30_000 * Math.pow(4, retries);
}

async function claimPendingJobs(): Promise<Job[]> {
  console.log('[claimPendingJobs] starting...');
  const db = getDb();
  try {
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
    console.log(`[claimPendingJobs] claimed ${rows.length} jobs`);
    return rows as unknown as Job[];
  } catch (err) {
    console.error('[claimPendingJobs] error:', err);
    throw err;
  }
}

function dispatch(job: Job): Promise<void> {
  console.log(`[dispatch] dispatching job ${job.id} of type ${job.job_type}`);
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

async function notifyFailure(job: Job): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    let telegramId: bigint | null = null;
    let text = 'Не удалось обработать запрос. Попробуйте ещё раз.';

    if (job.job_type === 'parse_wb' || job.job_type === 'parse_bank') {
      const imp = await findImportById(job.entity_id);
      const user = imp ? await findUserById(imp.user_id) : null;
      telegramId = user?.telegram_id ?? null;
      text =
        job.job_type === 'parse_wb'
          ? '❌ Не удалось обработать отчёт WB. Проверьте файл и попробуйте снова.'
          : '❌ Не удалось обработать выписку. Попробуйте другой файл или формат.';
    } else if (job.job_type === 'reconcile') {
      const run = await findRunById(job.entity_id);
      const user = run ? await findUserById(run.user_id) : null;
      telegramId = user?.telegram_id ?? null;
      text = '❌ Не удалось завершить сверку. Попробуйте запустить её ещё раз.';
    }

    if (!telegramId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(telegramId), text }),
    });
  } catch {
    // a failed notification must never break the runner
  }
}

async function processBatch(claimed: Job[]): Promise<void> {
  console.log(`[processBatch] processing ${claimed.length} jobs`);
  await Promise.all(
    claimed.map(async (job) => {
      try {
        console.log(`[processBatch] starting job ${job.id}`);
        await dispatch(job);
        await updateJob(job.id, {
          status: 'DONE',
          completed_at: new Date(),
          last_error: null,
        });
        console.log(`[processBatch] job ${job.id} completed successfully`);
      } catch (err) {
        const currentRetries = (job.retries ?? 0) + 1;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[processBatch] job ${job.id} failed: ${message}`);

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
            payload: { ...existingPayload, next_attempt_at: nextAttemptAt.toISOString() },
          });
          console.log(`[processBatch] job ${job.id} rescheduled for ${nextAttemptAt.toISOString()}`);
        }
      }
    }),
  );
}

export async function drainQueue(): Promise<number> {
  console.log('[drainQueue] started');
  let handled = 0;
  for (let i = 0; i < MAX_BATCHES_PER_DRAIN; i++) {
    console.log(`[drainQueue] batch ${i+1}`);
    const claimed = await claimPendingJobs();
    if (claimed.length === 0) {
      console.log('[drainQueue] no jobs claimed, stopping');
      break;
    }
    await processBatch(claimed);
    handled += claimed.length;
    console.log(`[drainQueue] handled ${handled} so far`);
  }
  console.log(`[drainQueue] finished, total handled: ${handled}`);
  return handled;
}
