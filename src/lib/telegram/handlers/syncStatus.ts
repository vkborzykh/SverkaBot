import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { msg } from '@/src/lib/telegram/messages.ru';
import type { BotContext } from '@/src/lib/telegram/router';

function formatAmount(kopeks: bigint | string | null | undefined): string {
  if (kopeks === null || kopeks === undefined) return '0.00';
  const n = Number(kopeks);
  return (n / 100).toFixed(2);
}

export async function handleSyncStatus(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const text = ctx.message?.text ?? '';
  // Extract run_id from "/sync_status <run_id>"
  const parts = text.trim().split(/\s+/);
  const runId = parts[1] ?? null;

  if (!runId) {
    await ctx.reply(msg.syncStatusMissingId);
    return;
  }

  const telegramId = BigInt(from.id);
  const user = await findUserByTelegramId(telegramId);
  if (!user) {
    await ctx.reply(msg.accessExpired);
    return;
  }

  const run = await findRunById(runId);
  if (!run || run.user_id !== user.id) {
    await ctx.reply(msg.syncStatusNotFound);
    return;
  }

  switch (run.status) {
    case 'PENDING':
      await ctx.reply(msg.syncStatusPending(runId));
      break;
    case 'RUNNING':
      await ctx.reply(msg.syncStatusRunning(runId));
      break;
    case 'COMPLETED': {
      const matchedCount = run.matched_count ?? 0;
      const unmatchedCount = run.unmatched_count ?? 0;
      const ambiguousCount = run.ambiguous_count ?? 0;
      const lossRub = formatAmount(run.unmatched_amount);
      await ctx.reply(
        msg.syncCompleted(matchedCount, unmatchedCount, ambiguousCount, lossRub),
      );
      if (run.ambiguous_amount && BigInt(run.ambiguous_amount) > BigInt(0)) {
        const ambiguousRub = formatAmount(run.ambiguous_amount);
        await ctx.reply(msg.syncStatusAmbiguousWarning(ambiguousRub));
      }
      await ctx.reply(msg.syncStatusDownloadReport(runId));
      break;
    }
    case 'FAILED':
      await ctx.reply(msg.syncStatusFailed(runId));
      break;
    default:
      await ctx.reply(msg.syncStatusUnknown(run.status ?? ''));
  }
}
