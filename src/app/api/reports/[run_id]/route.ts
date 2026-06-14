import { NextRequest } from 'next/server';
import { readFile } from 'fs/promises';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findPrimaryReportByRunId } from '@/src/db/repositories/reports';
import { getStorageFilePath } from '@/src/lib/ingestion/storage';

export async function GET(
  req: NextRequest,
  { params }: { params: { run_id: string } },
) {
  const guard = requireInternalToken(req);
  if (guard) return guard;

  const { run_id } = params;
  const userId = req.nextUrl.searchParams.get('user_id') ?? undefined;
  const download = req.nextUrl.searchParams.get('download') === '1';

  const run = await findRunById(run_id);
  if (!run) {
    return errResponse('NOT_FOUND', 'Reconciliation run not found', 404);
  }
  if (userId && run.user_id !== userId) {
    return errResponse('FORBIDDEN', 'Run does not belong to this user', 403);
  }

  const report = await findPrimaryReportByRunId(run_id);
  if (!report || !report.storage_path) {
    return errResponse(
      'REPORT_NOT_READY',
      'Отчёт ещё не готов, попробуйте позже',
      404,
    );
  }

  if (download) {
    const filePath = getStorageFilePath(report.storage_path);
    try {
      const buffer = await readFile(filePath);
      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="report_${run_id.slice(0, 8)}.zip"`,
          'Content-Length': String(buffer.length),
        },
      });
    } catch {
      return errResponse('FILE_NOT_FOUND', 'Report file not found on storage', 404);
    }
  }

  return okResponse({
    run_id: report.run_id,
    storage_path: report.storage_path,
    export_type: report.export_type,
    report_version: report.report_version,
    created_at: report.created_at,
  });
}
