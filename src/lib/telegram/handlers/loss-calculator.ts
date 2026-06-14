import type { Context } from 'telegraf';
import { setSession, getSession, clearSession } from '../session';
import { msg } from '../messages.ru';

export async function handleLossCalculator(ctx: Context): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);
  setSession(telegramId, 'awaiting_turnover');
  await ctx.reply(msg.lossCalcPrompt);
}

export async function handleTurnoverInput(
  ctx: Context & { message: { text: string } },
): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);
  const state = getSession(telegramId);
  if (state !== 'awaiting_turnover') return;

  const raw = ctx.message.text.replace(/[\s,]/g, '');
  const turnover = parseFloat(raw);

  if (isNaN(turnover) || turnover <= 0) {
    await ctx.reply(msg.lossCalcPrompt);
    return;
  }

  clearSession(telegramId);

  const monthly = Math.round(turnover * 0.04);
  const yearly = monthly * 12;

  await ctx.reply(
    msg.lossCalcResult(formatAmount(monthly), formatAmount(yearly)),
  );
}

function formatAmount(value: number): string {
  return value.toLocaleString('ru-RU');
}
