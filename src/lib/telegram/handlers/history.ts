import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';
import { msg } from '@/src/lib/telegram/messages.ru';
import type { BotContext } from '@/src/lib/telegram/router';

function fmtDate(d: string | Date): string {
  const dt = new Date(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

export async function handleHistory(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) {
    await ctx.reply(msg.historyEmpty);
    return;
  }

  const runs = await findRunsByUserId(user.id, 10);
  const completed = runs.filter((r) => r.status === 'COMPLETED');

  if (completed.length === 0) {
    await ctx.reply(msg.historyEmpty);
    return;
  }

  const lines = completed.map((r, i) =>
    msg.historyEntry(i + 1, fmtDate(r.created_at), r.loss_kopeks ?? BigInt(0)),
  );

  await ctx.reply(`${msg.historyHeader}\n\n${lines.join('\n')}`);
}
