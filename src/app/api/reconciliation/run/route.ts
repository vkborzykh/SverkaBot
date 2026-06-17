import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { startReconciliation } from '@/src/lib/reconciliation/startRun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Thin HTTP wrapper over the in-process service. The bot calls startReconciliation
// directly; this endpoint stays for internal/programmatic use.
export async function POST(req: NextRequest) {
  const guard = requireInternalToken(req);
  if (guard) return guard;

  let body: { wb_import_id?: string; bank_import_id?: string; user_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const userId = body.user_id ?? req.nextUrl.searchParams.get('user_id') ?? undefined;
  if (!userId) return errResponse('MISSING_USER_ID', 'user_id is required', 400);

  const result = await startReconciliation({
    userId,
    wbImportId: body.wb_import_id,
    bankImportId: body.bank_import_id,
  });

  if ('error' in result) {
    const code = result.error.code;
    const httpStatus =
      code === 'USER_NOT_FOUND' || code === 'IMPORT_NOT_FOUND'
        ? 404
        : code === 'ACCESS_DENIED'
        ? 403
        : 400;
    return errResponse(code, result.error.message, httpStatus);
  }

  return okResponse({ run_id: result.run_id, status: result.status });
}
