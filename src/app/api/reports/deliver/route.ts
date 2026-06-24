import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { findPrimaryReportByRunId } from '@/src/db/repositories/reports';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findUserById } from '@/src/db/repositories/users';
import { downloadReport } from '@/src/lib/ingestion/storage';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const guard = requireInternalToken(req);
  if (guard) return guard;

  const { run_id } = await req.json();
  if (!run_id) return errResponse('BAD_REQUEST', 'Missing run_id', 400);

  const report = await findPrimaryReportByRunId(run_id);
  if (!report) return errResponse('NOT_FOUND', 'Report not found', 404);

  const run = await findRunById(run_id);
  if (!run) return errResponse('NOT_FOUND', 'Run not found', 404);

  const user = await findUserById(run.user_id);
  if (!user?.telegram_id) return errResponse('NO_USER', 'User not found', 404);

  const fileBuffer = await downloadReport(report.storage_path);
  const token = process.env.TELEGRAM_BOT_TOKEN!;

  const formData = new FormData();
  formData.append('chat_id', String(user.telegram_id));
  formData.append('document', new Blob([fileBuffer], { type: 'text/html' }), `report_${run_id.slice(0, 8)}.html`);

  await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: formData,
  });

  return okResponse({ delivered: true });
}
