// Maps a job row to its handler. Shared by the legacy cron drain (runner.ts)
// and the BullMQ worker (bull/worker.ts) so dispatch logic lives in one place.
// The handlers themselves are unchanged — they receive the `jobs` row as-is.

import type { Job } from '@/src/db/repositories/jobs';
import { handleParseWb } from './handlers/parseWb';
import { handleParseBank } from './handlers/parseBank';
import { handleReconcile } from './handlers/reconcile';
import { handleReportExport } from './handlers/reportExport';
import { handleGenerateGoogleSheet } from './handlers/generateGoogleSheet';
import { handleSubscriptionReminder } from './handlers/subscriptionReminder';
import { handleInactivityReminder } from './handlers/inactivityReminder';
import { handleFileCleanup } from './handlers/fileCleanup';

export function dispatch(job: Job): Promise<void> {
  switch (job.job_type) {
    case 'parse_wb':
      return handleParseWb(job);
    case 'parse_bank':
      return handleParseBank(job);
    case 'reconcile':
      return handleReconcile(job);
    case 'report_export':
      return handleReportExport(job);
    case 'generate_google_sheet':
      return handleGenerateGoogleSheet(job);
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
