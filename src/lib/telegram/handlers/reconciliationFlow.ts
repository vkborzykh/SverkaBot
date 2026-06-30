import type { Context } from 'telegraf';
import { setSession, clearSession } from '../session';
import { mainMenuKeyboard } from '../keyboard';
import { msg } from '../messages.ru';

export async function handleNewReconciliation(ctx: Context, userId: string): Promise<void> {
  await setSession(BigInt(ctx.from!.id), 'reconciliation_active', {});
  await ctx.reply(msg.newReconciliationPrompt, mainMenuKeyboard);
}

export async function handleResetReconciliation(ctx: Context, telegramId: bigint): Promise<void> {
  await setSession(telegramId, 'reconciliation_active', {});
  await ctx.reply(msg.reconciliationReset, mainMenuKeyboard);
}
