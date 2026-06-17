import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findImportById } from '@/src/db/repositories/imports';
import { msg } from '@/src/lib/telegram/messages.ru';
import type { BotContext } from '@/src/lib/telegram/router';

function qualityRu(q: string | null | undefined): string {
  switch (q) {
    case 'HIGH_CONFIDENCE':
      return 'высокое';
    case 'LOW_CONFIDENCE':
      return 'низкое';
    case 'MANUAL_REVIEW':
      return 'требует проверки';
    default:
      return '—';
  }
}

export async function handleStatus(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const text = ctx.message?.text ?? '';
  const importId = text.trim().split(/\s+/)[1] ?? null;
  if (!importId) {
    await ctx.reply(msg.importStatusMissingId);
    return;
  }

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) {
    await ctx.reply(msg.accessExpired);
    return;
  }

  const imp = await findImportById(importId);
  if (!imp || imp.user_id !== user.id) {
    await ctx.reply(msg.importStatusNotFound);
    return;
  }

  switch (imp.status) {
    case 'RECEIVED':
      await ctx.reply(msg.importStatusReceived);
      break;
    case 'ANALYZING':
    case 'PARSING':
      await ctx.reply(msg.importStatusProcessing);
      break;
    case 'COMPLETED':
      await ctx.reply(
        msg.importStatusCompleted(
          qualityRu(imp.quality_status),
          imp.parse_success_rate ?? '0',
          imp.error_count ?? 0,
        ),
      );
      break;
    case 'FAILED':
      await ctx.reply(msg.importStatusFailed);
      break;
    default:
      await ctx.reply(msg.importStatusProcessing);
  }
}
