import { findUserByTelegramId } from '@/src/db/repositories/users';
import { msg } from '@/src/lib/telegram/messages.ru';
import type { BotContext } from '@/src/lib/telegram/router';

async function callRunApi(
  userId: string,
  wbImportId?: string,
  bankImportId?: string,
): Promise<{ run_id: string } | { error: { code: string; message: string } }> {
  const token = process.env.INTERNAL_TOKEN;
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VERCEL_URL ??
    'http://localhost:3000';
  const url = `${base.startsWith('http') ? base : `https://${base}`}/api/reconciliation/run`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-token': token ?? '',
    },
    body: JSON.stringify({
      user_id: userId,
      ...(wbImportId ? { wb_import_id: wbImportId } : {}),
      ...(bankImportId ? { bank_import_id: bankImportId } : {}),
    }),
  });

  const json = (await res.json()) as {
    success: boolean;
    data?: { run_id: string };
    error?: { code: string; message: string };
  };

  if (!json.success || !json.data) {
    return { error: json.error ?? { code: 'UNKNOWN', message: 'Unknown error' } };
  }
  return { run_id: json.data.run_id };
}

function errorCodeToRussian(code: string): string {
  switch (code) {
    case 'NO_ELIGIBLE_IMPORTS':
      return msg.syncNoEligibleImports;
    case 'PERIOD_MISMATCH':
      return msg.syncPeriodMismatch;
    case 'IMPORT_NOT_COMPLETED':
      return msg.syncNeedBothFilesCompleted;
    case 'ACCESS_DENIED':
      return msg.accessExpired;
    default:
      return msg.syncNeedBothFiles;
  }
}

export async function handleRunSync(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const telegramId = BigInt(from.id);
  const user = await findUserByTelegramId(telegramId);
  if (!user) {
    await ctx.reply(msg.accessExpired);
    return;
  }

  const result = await callRunApi(user.id);

  if ('error' in result) {
    await ctx.reply(errorCodeToRussian(result.error.code));
    return;
  }

  await ctx.reply(msg.syncStarted(result.run_id));

  // Warn if the bank import had LOW_CONFIDENCE — check via the run we just created
  // (The reconcile job also sends this warning on completion, but we send it upfront too)
}
