import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';

export async function GET(
  req: NextRequest,
  { params }: { params: { run_id: string } },
) {
  const guard = requireInternalToken(req);
  if (guard) return guard;

  const { run_id } = params;
  const userId = req.nextUrl.searchParams.get('user_id');
  if (!userId) {
    return errResponse('MISSING_USER_ID', 'user_id обязателен', 400);
  }

  const run = await findRunById(run_id);
  if (!run) {
    return errResponse('NOT_FOUND', 'Reconciliation run not found', 404);
  }

  if (run.user_id !== userId) {
    return errResponse('FORBIDDEN', 'Run does not belong to this user', 403);
  }

  return okResponse({
    run_id: run.id,
    status: run.status,
    wb_import_id: run.wb_import_id,
    bank_import_id: run.bank_import_id,
    matched_count: run.matched_count,
    unmatched_count: run.unmatched_count,
    ambiguous_count: run.ambiguous_count,
    split_count: run.split_count,
    combined_count: run.combined_count,
    match_rate: run.match_rate,
    unmatched_amount: run.unmatched_amount?.toString() ?? null,
    ambiguous_amount: run.ambiguous_amount?.toString() ?? null,
    failure_reason: run.failure_reason,
    started_at: run.started_at,
    completed_at: run.completed_at,
  });
}
