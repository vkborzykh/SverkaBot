import { findUserByTelegramId } from '@/src/db/repositories/users';
import { checkAccess } from '@/src/lib/telegram/access';
import { startReconciliation } from '@/src/lib/reconciliation/startRun';
import { enqueue } from '@/src/lib/jobs/queue';
import { msg } from '@/src/lib/telegram/messages.ru';
import type { BotContext } from '@/src/lib/telegram/router';

function errorCodeToRussian(code: string): string {
  switch (code) {
    case 'NO_ELIGIBLE_IMPORTS':
      return msg.syncNoEligibleImports;
    case 'PERIOD_MISMATCH':
      return msg.syncPeriodMismatch;
    case 'IMPORT_NOT_COMPLETED':
      return msg.syncNeedBothFilesCompleted;
    case 'IMPORT_NOT_FOUND':
      return msg.syncNeedBothFiles;
    case 'ACCESS_DENIED':
      return msg.accessExpired;
    default:
      return msg.syncNeedBothFiles;
  }
}

export async function handleRunSync(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) {
    await ctx.reply(msg.accessExpired);
    return;
  }
  if (checkAccess(user) !== 'full') {
    await ctx.reply(msg.accessExpired);
    return;
  }

  try {
    const result = await startReconciliation({ userId: user.id });
    if ('error' in result) {
      await ctx.reply(errorCodeToRussian(result.error.code));
      return;
    }

    // Ставим задачу в очередь
    await enqueue('reconcile', result.run_id, { run_id: result.run_id });
    // Отправляем сообщение о запуске
    await ctx.reply(msg.syncStarted(result.run_id));
  } catch (err) {
    console.error('[runSync] failed:', err);
    await ctx.reply(msg.syncGenericError);
  }
}
