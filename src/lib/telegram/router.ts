import { createBillingTransaction, findBillingTransactionByProviderTxId } from '@/src/db/repositories/billing-transactions';
import type { Update, User as TgUser } from 'telegraf/types';
import { findUserByTelegramId, updateUser } from '@/src/db/repositories/users';
import { checkAccess, PROTECTED_COMMANDS } from './access';
import { getSession } from './session';
import { handleStart, handleConsentAccept, handleConsentDecline } from './handlers/start';
import {
  handleWbFileReceived,
  handleBankFileReceived,
  type DocumentInfo,
} from './handlers/upload';
import { handleHistory, handleHistoryReport, handleHistoryHtml, handleDownloadWb, handleDownloadBank } from './handlers/history';
import { handleStatus } from './handlers/status';
import { handleGetReport } from './handlers/getReport';
import { handleHelp } from './handlers/stubs';
import { handleDeleteMyData, handleDeleteConfirm, handleDeleteCancel } from './handlers/deleteData';
import { handleSubscribe, handleReferral, handleTariffStart, handleTariffPro, handleTariffBusiness } from './handlers/subscribe';
import { handleRetryImport } from './handlers/retryImport';
import { handleCancel } from './handlers/cancelOp';
import {
  isAdmin,
  handleViewProfiles,
  handleActivateProfile,
  handleDeprecateProfile,
  handleViewErrors,
  handleStats,
  handleRetryExport,
} from './handlers/admin';
import {
  handleNewReconciliation,
  handleUploadWbInline,
  handleReplaceWb,
  handleUploadBankInline,
  handleReplaceBank,
  handleRunSyncInline,
  handleCabinetPick,
} from './handlers/reconciliationFlow';
import {
  handleMyCabinets,
  handleCabinetAdd,
  handleCabinetDelete,
  handleCabinetNameReceived,
  handleCabinetUse,
} from './handlers/myCabinets';
import { handleDynamics, handleDynamicsFilter } from './handlers/dynamics';
import { TARIFF_BY_AMOUNT_KOPEKS } from '@/src/lib/billing/tariffs';
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

  if ('message' in update && update.message && 'successful_payment' in update.message) {
    const sp = update.message.successful_payment;
    const telegramId = BigInt(update.message.chat.id);

    const tariff = TARIFF_BY_AMOUNT_KOPEKS[sp.total_amount];
    const isValidAmount = tariff || sp.total_amount === 120000;
    if (!isValidAmount || sp.currency !== 'RUB') {
      console.error('[successful_payment] Invalid amount or currency', sp.total_amount, sp.currency);
      return;
    }

    try {
      const user = await findUserByTelegramId(telegramId);
      if (user) {
        const existing = await findBillingTransactionByProviderTxId(sp.telegram_payment_charge_id);
        if (existing) return;

        const { activateSubscription } = await import('@/src/lib/billing/subscription');
        const endDate = await activateSubscription(user.id, 30);

        if (tariff) await updateUser(user.id, { tariff, monthly_reconciliations: 0 });

        let referralBonusGranted = false;
        if (user.invited_by) {
          const referrer = await findUserByTelegramId(user.invited_by);
          if (referrer && referrer.subscription_status === 'ACTIVE' && referrer.subscription_end_date) {
            const newEndDate = new Date(referrer.subscription_end_date.getTime() + 14 * 24 * 60 * 60 * 1000);
            await updateUser(referrer.id, { subscription_end_date: newEndDate });
            referralBonusGranted = true;

            const token = process.env.TELEGRAM_BOT_TOKEN;
            if (token) {
              fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: String(user.invited_by),
                  text: '🎉 Ваш друг оформил подписку! Вам начислено +14 дней.',
                }),
              }).catch(() => {});
            }
          }
        }

        await createBillingTransaction({
          user_id: user.id,
          amount_kopeks: BigInt(sp.total_amount),
          currency: sp.currency,
          status: 'SUCCESS',
          provider: 'telegram',
          provider_tx_id: sp.telegram_payment_charge_id,
          confirmation_url: null,
          referral_bonus_granted: referralBonusGranted,
        });

        const formatted = endDate.toLocaleDateString('ru-RU', {
          day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
        });
        await ctx.reply(`Оплата прошла успешно! Ваша подписка активна до ${formatted}. Спасибо!`);
      }
    } catch (err) {
      console.error('[successful_payment] error:', err);
      await ctx.reply('Произошла ошибка при активации подписки. Пожалуйста, обратитесь в поддержку.');
    }
    return;
  }

  if ('message' in update && update.message) {
    const message = update.message;
    const from = ctx.from;
    if (!from) return;

    const telegramId = BigInt(from.id);
    const sessionState = await getSession(telegramId);

    if ('document' in message && message.document) {
      const doc = message.document as { file_id: string; file_name?: string; file_size?: number };
      const docInfo: DocumentInfo = {
        fileId: doc.file_id,
        fileName: doc.file_name ?? 'file',
        fileSizeBytes: doc.file_size ?? 0,
      };

      if (sessionState === 'awaiting_wb_file') {
        await handleWbFileReceived(ctx, docInfo);
        return;
      }
      if (sessionState === 'awaiting_bank_file') {
        await handleBankFileReceived(ctx, docInfo);
        return;
      }
      await ctx.reply(msg.uploadNoSession);
      return;
    }

    if (!('text' in message) || !message.text) return;

    const text = message.text.trim();

    const commandMap: Record<string, string> = {
      [msg.menuNewReconciliation]: 'new_reconciliation',
      [msg.menuSubscribe]: 'subscribe',
      [msg.menuMyCabinets]: 'my_cabinets',
      [msg.menuHelp]: 'help',
      [msg.menuHistory]: 'history',
      [msg.menuDeleteData]: 'delete_my_data',
    };

    if (sessionState === 'awaiting_cabinet_name' && !text.startsWith('/') && !commandMap[text]) {
      await handleCabinetNameReceived(ctx as any, text);
      return;
    }

    let command = '';
    if (text.startsWith('/')) {
      command = text.slice(1).split(' ')[0].toLowerCase();
    } else if (commandMap[text]) {
      command = commandMap[text];
    }

    if (!command) return;

    if (command === 'start') {
      await handleStart(ctx as Parameters<typeof handleStart>[0]);
      return;
    }

    const ADMIN_COMMANDS = new Set([
      'view_profiles', 'activate_profile', 'deprecate_profile',
      'view_errors', 'stats', 'retry_export',
    ]);

    if (ADMIN_COMMANDS.has(command)) {
      if (!isAdmin(telegramId)) { await ctx.reply(msg.adminNotAuthorized); return; }
      switch (command) {
        case 'view_profiles': await handleViewProfiles(ctx as Parameters<typeof handleViewProfiles>[0]); break;
        case 'activate_profile': await handleActivateProfile(ctx as Parameters<typeof handleActivateProfile>[0]); break;
        case 'deprecate_profile': await handleDeprecateProfile(ctx as Parameters<typeof handleDeprecateProfile>[0]); break;
        case 'view_errors': await handleViewErrors(ctx as Parameters<typeof handleViewErrors>[0]); break;
        case 'stats': await handleStats(ctx as Parameters<typeof handleStats>[0]); break;
        case 'retry_export': await handleRetryExport(ctx as Parameters<typeof handleRetryExport>[0]); break;
      }
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
      case 'new_reconciliation': await handleNewReconciliation(ctx as Parameters<typeof handleNewReconciliation>[0], user.id); break;
      case 'subscribe': await handleSubscribe(ctx as any); break;
      case 'referral': await handleReferral(ctx as any); break;
      case 'my_cabinets': await handleMyCabinets(ctx as any); break;
      case 'dynamics': await handleDynamics(ctx as any); break;
      case 'help': await handleHelp(ctx as Parameters<typeof handleHelp>[0]); break;
      case 'history': await handleHistory(ctx as Parameters<typeof handleHistory>[0]); break;
      case 'delete_my_data': await handleDeleteMyData(ctx as Parameters<typeof handleDeleteMyData>[0]); break;
      case 'get_report': await handleGetReport(ctx as Parameters<typeof handleGetReport>[0]); break;
      case 'status': await handleStatus(ctx as Parameters<typeof handleStatus>[0]); break;
      case 'sync_status': await import('./handlers/syncStatus').then(m => m.handleSyncStatus(ctx as any)); break;
      case 'retry_import': await handleRetryImport(ctx as Parameters<typeof handleRetryImport>[0]); break;
      case 'cancel': await handleCancel(ctx as Parameters<typeof handleCancel>[0]); break;
      case 'upload_wb': case 'upload_bank': case 'run_sync':
        await ctx.reply('Используйте кнопки в чате для выполнения этой операции.'); break;
      default: break;
    }
  }

  if ('callback_query' in update && update.callback_query) {
    const cbq = update.callback_query;
    const data = 'data' in cbq ? cbq.data : undefined;
    if (!data) return;

    if (data.startsWith('cabinet_del:')) {
      await handleCabinetDelete(ctx as any, data.slice('cabinet_del:'.length));
      return;
    }
    if (data.startsWith('cabinet_pick:')) {
      await handleCabinetPick(ctx as any, data.slice('cabinet_pick:'.length));
      return;
    }
    if (data.startsWith('cabinet_use:')) {
      await handleCabinetUse(ctx as any, data.slice('cabinet_use:'.length));
      return;
    }
    if (data.startsWith('dynamics_cabinet:')) {
      await handleDynamicsFilter(ctx as any, data.slice('dynamics_cabinet:'.length));
      return;
    }
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
    if (data === 'dynamics_all') {
      await handleDynamicsFilter(ctx as any, 'all');
      return;
    }

    switch (data) {
      case 'cabinet_add': await handleCabinetAdd(ctx as any); break;
      case 'my_cabinets': await handleMyCabinets(ctx as any); break;
      case 'tariff_start': await import('./handlers/subscribe').then(m => m.handleTariffStart(ctx as any)); break;
      case 'tariff_pro': await import('./handlers/subscribe').then(m => m.handleTariffPro(ctx as any)); break;
      case 'tariff_business': await import('./handlers/subscribe').then(m => m.handleTariffBusiness(ctx as any)); break;
      case 'consent:accept': await handleConsentAccept(ctx as Parameters<typeof handleConsentAccept>[0]); break;
      case 'consent:decline': await handleConsentDecline(ctx as Parameters<typeof handleConsentDecline>[0]); break;
      case 'delete:confirm': await handleDeleteConfirm(ctx as Parameters<typeof handleDeleteConfirm>[0]); break;
      case 'delete:cancel': await handleDeleteCancel(ctx as Parameters<typeof handleDeleteCancel>[0]); break;
      case 'new_reconciliation': {
        const user = await findUserByTelegramId(BigInt(ctx.from!.id));
        if (user) await handleNewReconciliation(ctx as any, user.id);
        break;
      }
      case 'upload_wb_inline': await handleUploadWbInline(ctx as any); break;
      case 'replace_wb': await handleReplaceWb(ctx as any); break;
      case 'upload_bank_inline': await handleUploadBankInline(ctx as any); break;
      case 'replace_bank': await handleReplaceBank(ctx as any); break;
      case 'run_sync_inline': await handleRunSyncInline(ctx as any); break;
      case 'subscribe_inline': await handleSubscribe(ctx as any); break;
    }
  }
}
