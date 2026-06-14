import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { findUserById } from '@/src/db/repositories/users';
import { findImportsByUserId, findImportById } from '@/src/db/repositories/imports';
import { createRun } from '@/src/db/repositories/reconciliation-runs';
import { checkAccess } from '@/src/lib/telegram/access';
import { enqueue } from '@/src/lib/jobs/queue';
import { getSetting } from '@/src/lib/settings/settings';
import { findTransactionsByImportId } from '@/src/db/repositories/canonical-transactions';

const DATE_OVERLAP_DAYS = 31;

function parseDateStr(d: string | null | undefined): Date | null {
  if (!d) return null;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function periodsOverlap(
  wbStart: string | null | undefined,
  wbEnd: string | null | undefined,
  bankStart: string | null | undefined,
  bankEnd: string | null | undefined,
  windowDays: number,
): boolean {
  // If any period is missing, allow and let the job handle validation
  if (!wbStart || !wbEnd || !bankStart || !bankEnd) return true;

  const wbS = parseDateStr(wbStart);
  const wbE = parseDateStr(wbEnd);
  const bkS = parseDateStr(bankStart);
  const bkE = parseDateStr(bankEnd);
  if (!wbS || !wbE || !bkS || !bkE) return true;

  const windowMs = windowDays * 86_400_000;
  // Intervals overlap if one starts before the other ends (+window tolerance)
  return wbS.getTime() <= bkE.getTime() + windowMs &&
    bkS.getTime() <= wbE.getTime() + windowMs;
}

export async function POST(req: NextRequest) {
  const guard = requireInternalToken(req);
  if (guard) return guard;

  let body: { wb_import_id?: string; bank_import_id?: string; user_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const userId =
    body.user_id ??
    (req.nextUrl.searchParams.get('user_id') ?? undefined);

  if (!userId) {
    return errResponse('MISSING_USER_ID', 'user_id is required', 400);
  }

  const user = await findUserById(userId);
  if (!user) {
    return errResponse('USER_NOT_FOUND', 'User not found', 404);
  }

  const access = checkAccess(user);
  if (access === 'none' || access === 'readonly') {
    return errResponse('ACCESS_DENIED', 'Subscription required to run reconciliation', 403);
  }

  const dateWindowDays =
    (await getSetting<number>('date_window_days')) ?? DATE_OVERLAP_DAYS;

  let wbImportId = body.wb_import_id;
  let bankImportId = body.bank_import_id;

  if (wbImportId && bankImportId) {
    // Explicit ids provided — validate ownership, status, and period overlap
    const [wbImp, bankImp] = await Promise.all([
      findImportById(wbImportId),
      findImportById(bankImportId),
    ]);

    if (!wbImp || wbImp.user_id !== userId || wbImp.source_type !== 'WB') {
      return errResponse('IMPORT_NOT_FOUND', 'WB import not found or not owned by user', 404);
    }
    if (!bankImp || bankImp.user_id !== userId || bankImp.source_type !== 'BANK') {
      return errResponse('IMPORT_NOT_FOUND', 'Bank import not found or not owned by user', 404);
    }
    if (wbImp.status !== 'COMPLETED') {
      return errResponse('IMPORT_NOT_COMPLETED', 'WB import is not COMPLETED', 400);
    }
    if (bankImp.status !== 'COMPLETED') {
      return errResponse('IMPORT_NOT_COMPLETED', 'Bank import is not COMPLETED', 400);
    }
    if (
      !periodsOverlap(
        wbImp.period_start,
        wbImp.period_end,
        bankImp.period_start,
        bankImp.period_end,
        dateWindowDays,
      )
    ) {
      return errResponse('PERIOD_MISMATCH', 'Import periods do not overlap', 400);
    }
  } else {
    // Auto-select latest COMPLETED imports
    const [wbImports, bankImports] = await Promise.all([
      findImportsByUserId(userId, { sourceType: 'WB', status: 'COMPLETED' }),
      findImportsByUserId(userId, { sourceType: 'BANK', status: 'COMPLETED' }),
    ]);

    // Filter to only COMPLETED
    const completedWb = wbImports.filter((i) => i.status === 'COMPLETED');
    const completedBank = bankImports.filter((i) => i.status === 'COMPLETED');

    if (completedWb.length === 0 || completedBank.length === 0) {
      return errResponse(
        'NO_ELIGIBLE_IMPORTS',
        'No completed WB or bank imports found',
        400,
      );
    }

    // Sort descending by created_at (most recent first)
    const latestWb = completedWb.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const latestBank = completedBank.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    // Find first pair with overlapping periods
    let found = false;
    for (const wb of latestWb) {
      for (const bank of latestBank) {
        if (
          periodsOverlap(
            wb.period_start,
            wb.period_end,
            bank.period_start,
            bank.period_end,
            dateWindowDays,
          )
        ) {
          wbImportId = wb.id;
          bankImportId = bank.id;
          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      return errResponse(
        'NO_ELIGIBLE_IMPORTS',
        'No WB and bank imports with overlapping periods found',
        400,
      );
    }
  }

  // Count transactions for row totals
  const [wbTxs, bankTxs] = await Promise.all([
    findTransactionsByImportId(wbImportId!),
    findTransactionsByImportId(bankImportId!),
  ]);

  const run = await createRun({
    user_id: userId,
    wb_import_id: wbImportId!,
    bank_import_id: bankImportId!,
    status: 'PENDING',
    total_wb_rows: wbTxs.length,
    total_bank_rows: bankTxs.length,
    started_at: new Date(),
  });

  await enqueue('reconcile', run.id, { run_id: run.id });

  return okResponse({ run_id: run.id, status: 'PENDING' });
}
