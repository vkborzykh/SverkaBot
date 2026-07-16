import { findUserById } from '@/src/db/repositories/users';
import { findImportsByUserId, findImportById } from '@/src/db/repositories/imports';
import { createRun } from '@/src/db/repositories/reconciliation-runs';
import { checkAccess } from '@/src/lib/telegram/access';
import { getSetting } from '@/src/lib/settings/settings';
import { findTransactionsByImportId } from '@/src/db/repositories/canonical-transactions';

const DATE_OVERLAP_DAYS = 31;

export type StartRunResult =
  | { run_id: string; status: 'PENDING' }
  | { error: { code: string; message: string } };

export interface StartRunParams {
  userId: string;
  wbImportId?: string;
  bankImportId?: string;
}

function parseDateStr(d: string | null | undefined): Date | null {
  if (!d) return null;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function periodsCover(
  wbStart: string | null | undefined,
  wbEnd: string | null | undefined,
  bankStart: string | null | undefined,
  bankEnd: string | null | undefined,
  windowDays: number,
): boolean {
  if (!wbStart || !wbEnd || !bankStart || !bankEnd) return true;
  const wbS = parseDateStr(wbStart);
  const wbE = parseDateStr(wbEnd);
  const bkS = parseDateStr(bankStart);
  const bkE = parseDateStr(bankEnd);
  if (!wbS || !wbE || !bkS || !bkE) return true;
  const windowMs = windowDays * 86_400_000;
  return wbS.getTime() >= bkS.getTime() - windowMs && wbE.getTime() <= bkE.getTime() + windowMs;
}

export async function startReconciliation(params: StartRunParams): Promise<StartRunResult> {
  console.log('[startReconciliation] called with params:', params);
  const { userId } = params;

  const user = await findUserById(userId);
  if (!user) {
    console.log('[startReconciliation] User not found');
    return { error: { code: 'USER_NOT_FOUND', message: 'User not found' } };
  }

  const access = checkAccess(user);
  if (access === 'none' || access === 'readonly') {
    console.log('[startReconciliation] Access denied');
    return { error: { code: 'ACCESS_DENIED', message: 'Subscription required' } };
  }

  const dateWindowDays = (await getSetting<number>('date_window_days')) ?? DATE_OVERLAP_DAYS;

  let wbImportId = params.wbImportId;
  let bankImportId = params.bankImportId;

  if (wbImportId && bankImportId) {
    const [wbImp, bankImp] = await Promise.all([
      findImportById(wbImportId),
      findImportById(bankImportId),
    ]);
    if (!wbImp || wbImp.user_id !== userId || wbImp.source_type !== 'WB') {
      return { error: { code: 'IMPORT_NOT_FOUND', message: 'WB import not found' } };
    }
    if (!bankImp || bankImp.user_id !== userId || bankImp.source_type !== 'BANK') {
      return { error: { code: 'IMPORT_NOT_FOUND', message: 'Bank import not found' } };
    }
    if (wbImp.status !== 'COMPLETED' || bankImp.status !== 'COMPLETED') {
      return { error: { code: 'IMPORT_NOT_COMPLETED', message: 'Import not COMPLETED' } };
    }
    // Проверка периодов для явно переданных импортов теперь делается в вызывающем коде
  } else {
    const [wbImports, bankImports] = await Promise.all([
      findImportsByUserId(userId, { sourceType: 'WB', status: 'COMPLETED' }),
      findImportsByUserId(userId, { sourceType: 'BANK', status: 'COMPLETED' }),
    ]);
    const completedWb = wbImports.filter((i) => i.status === 'COMPLETED');
    const completedBank = bankImports.filter((i) => i.status === 'COMPLETED');
    if (completedWb.length === 0 || completedBank.length === 0) {
      return { error: { code: 'NO_ELIGIBLE_IMPORTS', message: 'No completed imports' } };
    }
    const byDateDesc = <T extends { created_at: string | Date }>(a: T, b: T) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    const latestWb = [...completedWb].sort(byDateDesc);
    const latestBank = [...completedBank].sort(byDateDesc);

    let found = false;
    for (const wb of latestWb) {
      for (const bank of latestBank) {
        if (periodsCover(wb.period_start, wb.period_end, bank.period_start, bank.period_end, dateWindowDays)) {
          wbImportId = wb.id;
          bankImportId = bank.id;
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) {
      return { error: { code: 'NO_ELIGIBLE_IMPORTS', message: 'No overlapping imports' } };
    }
  }

  const [wbTxs, bankTxs] = await Promise.all([
    findTransactionsByImportId(wbImportId!),
    findTransactionsByImportId(bankImportId!),
  ]);

  console.log('[startReconciliation] Creating run...');
  const run = await createRun({
    user_id: userId,
    wb_import_id: wbImportId!,
    bank_import_id: bankImportId!,
    status: 'PENDING',
    total_wb_rows: wbTxs.length,
    total_bank_rows: bankTxs.length,
    started_at: new Date(),
  });

  return { run_id: run.id, status: 'PENDING' };
}
