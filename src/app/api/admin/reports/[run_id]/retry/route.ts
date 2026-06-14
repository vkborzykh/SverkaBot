import { NextRequest } from 'next/server';
import { requireAdminToken } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findPrimaryReportByRunId } from '@/src/db/repositories/reports';
import { enqueue } from '@/src/lib/jobs/queue';
import { getDb } from '@/src/db/index';
import { reports } from '@/src/db/schema';
import { eq, and } from 'drizzle-orm';

export async function POST(
  req: NextRequest,
  { params }: { params: { run_id: string } },
) {
  const guard = requireAdminToken(req);
  if (guard) return guard;

  const run = await findRunById(params.run_id);
  if (!run) {
    return errResponse('RUN_NOT_FOUND', 'Reconciliation run not found', 404);
  }

  // Mark previous primary report as non-primary
  const existingReport = await findPrimaryReportByRunId(params.run_id);
  if (existingReport) {
    const db = getDb();
    await db
      .update(reports)
      .set({ is_primary: false })
      .where(and(eq(reports.id, existingReport.id)));
  }

  const jobId = await enqueue('report_export', params.run_id, {
    run_id: params.run_id,
    retry: true,
  });

  return okResponse({ run_id: params.run_id, job_id: jobId, queued: true });
}
