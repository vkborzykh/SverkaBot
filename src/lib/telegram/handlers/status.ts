import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findImportById } from '@/src/db/repositories/imports';
import { msg } from '@/src/lib/telegram/messages.ru';

// Локальный тип вместо удалённого router.ts
export interface BotContext {
  from: { id: number; username?: string } | undefined;
  reply(text: string, extra?: unknown): Promise<unknown>;
  message?: { text?: string };
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
    case 'RUNNING':
      await ctx.reply(msg.importStatusProcessing);
      break;
    case 'FAILED':
      await ctx.reply(msg.importStatusFailed);
      break;
    case 'COMPLETED': {
      const qualityLabel =
        imp.quality_status === 'NORMAL'
          ? 'высокое'
          : imp.quality_status === 'LOW_CONFIDENCE'
            ? 'низкое'
            : imp.quality_status === 'MANUAL_REVIEW'
              ? 'требуется проверка'
              : '—';
      await ctx.reply(
        msg.importStatusCompleted(
          qualityLabel,
          imp.parse_success_rate ?? '—',
          imp.error_count ?? 0,
        ),
      );
      break;
    }
    default:
      break;
  }
}
