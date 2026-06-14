import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { msg } from '@/src/lib/telegram/messages.ru';
import type { BotContext } from '@/src/lib/telegram/router';

function formatAmount(kopeks: bigint | string | null | undefined): string {
  if (kopeks === null || kopeks === undefined) return '0.00';
  const n = typeof kopeks === 'bigint' ? Number(kopeks) : parseFloat(String(kopeks));
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
    await ctx.reply('Укажите ID сверки: /sync_status <id>');
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
    await ctx.reply('Сверка не найдена или не принадлежит вашему аккаунту.');
    return;
  }

  switch (run.status) {
    case 'PENDING':
      await ctx.reply(`⏳ Сверка ${runId} ожидает обработки.`);
      break;
    case 'RUNNING':
      await ctx.reply(`🔄 Сверка ${runId} выполняется. Пожалуйста, подождите.`);
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
        await ctx.reply(`⚠️ Неоднозначных транзакций на сумму ${ambiguousRub} ₽. Рекомендуем проверить вручную.`);
      }
      await ctx.reply(`Для скачивания отчёта: /get_report ${runId}`);
      break;
    }
    case 'FAILED':
      await ctx.reply(
        `❌ Сверка завершилась с ошибкой. ID: ${runId}. Попробуйте запустить сверку снова или обратитесь в поддержку.`,
      );
      break;
    default:
      await ctx.reply(`Статус сверки: ${run.status}`);
  }
}
