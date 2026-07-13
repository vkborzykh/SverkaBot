import type { Update, User as TgUser } from 'telegraf/types';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { handleStart } from './handlers/start';
import { msg } from './messages.ru';

export interface BotContext {
  from: TgUser | undefined;
  reply(text: string, extra?: unknown): Promise<unknown>;
  answerCbQuery(text?: string): Promise<unknown>;
  answerPreCheckoutQuery(query: { pre_checkout_query_id: string; ok: boolean; error_message?: string }): Promise<unknown>;
  replyWithInvoice(invoice: any, extra?: any): Promise<unknown>;
  editMessageReplyMarkup(markup: unknown): Promise<unknown>;
  message?: { text?: string };
  callbackQuery?: { data?: string };
}

export async function routeUpdate(
  update: Update,
  sendMessage: (chatId: number, text: string, extra?: unknown) => Promise<void>,
  buildCtx: (update: Update) => BotContext,
): Promise<void> {
  const ctx = buildCtx(update);

  if ('pre_checkout_query' in update && update.pre_checkout_query) {
    const pq = update.pre_checkout_query;
    await ctx.answerPreCheckoutQuery({ pre_checkout_query_id: pq.id, ok: true });
    return;
  }

  if ('message' in update && update.message && 'text' in update.message) {
    const from = ctx.from;
    if (!from) return;
    const text = update.message.text.trim();
    
    if (text.startsWith('/start') || text === '/start') {
      const user = await findUserByTelegramId(BigInt(from.id));
      await handleStart(ctx as Parameters<typeof handleStart>[0], user?.tariff);
      return;
    }
    
    // Для остальных команд — заглушка
    await ctx.reply('Бот работает в тестовом режиме');
    return;
  }
}
