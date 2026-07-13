import type { Update, User as TgUser } from 'telegraf/types';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { checkAccess, PROTECTED_COMMANDS } from './access';
import { getSession } from './session';
import { handleStart, handleConsentAccept, handleConsentDecline } from './handlers/start';
import { handleHistory, handleHistoryReport, handleHistoryHtml, handleDownloadWb, handleDownloadBank, handleExportMenu } from './handlers/history';
import { handleHelp } from './handlers/stubs';
import { handleDeleteMyData, handleDeleteConfirm, handleDeleteCancel } from './handlers/deleteData';
import { handleSubscribe, handleReferral } from './handlers/subscribe';
import { handleRetryImport } from './handlers/retryImport';
import { handleCancel } from './handlers/cancelOp';
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

async function replyAccessExpired(ctx: BotContext): Promise<void> {
  await ctx.reply(msg.accessExpired, {
    reply_markup: {
      inline_keyboard: [[{ text: '💰 Подписка', callback_data: 'subscribe_inline' }]],
    },
  });
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

  if ('message' in update && update.message) {
    const message = update.message;
    const from = ctx.from;
    if (!from) return;

    const telegramId = BigInt(from.id);
    const sessionState = await getSession(telegramId);

    if (!('text' in message) || !message.text) return;

    const text = message.text.trim();

    const commandMap: Record<string, string> = {
      [msg.menuNewReconciliation]: 'new_reconciliation',
      [msg.menuSubscribe]: 'subscribe',
      [msg.menuMyCabinets]: 'my_cabinets',
      [msg.menuHelp]: 'help',
      [msg.menuHistory]: 'history',
      [msg.menuStatistics]: 'statistics',
      [msg.menuDeleteData]: 'delete_my_data',
    };

    let command = '';
    if (text.startsWith('/')) {
      command = text.slice(1).split(' ')[0].toLowerCase();
    } else if (commandMap[text]) {
      command = commandMap[text];
    }

    if (!command) return;

    if (command === 'start') {
      const user = await findUserByTelegramId(telegramId);
      await handleStart(ctx as Parameters<typeof handleStart>[0], user?.tariff);
      return;
    }

    const user = await findUserByTelegramId(telegramId);
    if (!user) { await handleStart(ctx as Parameters<typeof handleStart>[0]); return; }

    const access = checkAccess(user);
    if (access !== 'full' && PROTECTED_COMMANDS.has(command)) {
      await replyAccessExpired(ctx);
      return;
    }

    switch (command) {
      case 'subscribe': await handleSubscribe(ctx as any); break;
      case 'referral': await handleReferral(ctx as any); break;
      case 'help': await handleHelp(ctx as Parameters<typeof handleHelp>[0]); break;
      case 'history': await handleHistory(ctx as Parameters<typeof handleHistory>[0]); break;
      case 'delete_my_data': await handleDeleteMyData(ctx as Parameters<typeof handleDeleteMyData>[0]); break;
      default: break;
    }
  }

  if ('callback_query' in update && update.callback_query) {
    const cbq = update.callback_query;
    const data = 'data' in cbq ? cbq.data : undefined;
    if (!data) return;

    if (data.startsWith('history_report:')) {
      await handleHistoryReport(ctx as any, data.slice('history_report:'.length));
      return;
    }
    if (data.startsWith('history_html:')) {
      await handleHistoryHtml(ctx as any, data.slice('history_html:'.length));
      return;
    }
    if (data.startsWith('download_wb:')) {
      await handleDownloadWb(ctx as any, data.slice('download_wb:'.length));
      return;
    }
    if (data.startsWith('download_bank:')) {
      await handleDownloadBank(ctx as any, data.slice('download_bank:'.length));
      return;
    }
    if (data.startsWith('export_menu:')) {
      await handleExportMenu(ctx as any, data.slice('export_menu:'.length));
      return;
    }

    switch (data) {
      case 'consent:accept': await handleConsentAccept(ctx as Parameters<typeof handleConsentAccept>[0]); break;
      case 'consent:decline': await handleConsentDecline(ctx as Parameters<typeof handleConsentDecline>[0]); break;
      case 'delete:confirm': await handleDeleteConfirm(ctx as Parameters<typeof handleDeleteConfirm>[0]); break;
      case 'delete:cancel': await handleDeleteCancel(ctx as Parameters<typeof handleDeleteCancel>[0]); break;
      case 'subscribe_inline': await handleSubscribe(ctx as any); break;
    }
  }
}
