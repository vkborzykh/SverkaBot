import type { Update, User as TgUser } from 'telegraf/types';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { checkAccess, PROTECTED_COMMANDS } from './access';
import { getSession, clearSession } from './session';
import { handleStart, handleConsentAccept, handleConsentDecline } from './handlers/start';
import {
  handleWbFileReceived,
  handleBankFileReceived,
  type DocumentInfo,
} from './handlers/upload';
import { handleHistory } from './handlers/history';
import { handleStatus } from './handlers/status';
import { handleGetReport } from './handlers/getReport';
import { handleHelp } from './handlers/stubs';
import { handleDeleteMyData, handleDeleteConfirm, handleDeleteCancel } from './handlers/deleteData';
import { handleSubscribe } from './handlers/subscribe';
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
} from './handlers/reconciliationFlow';
import { msg } from './messages.ru';

export interface BotContext {
  from: TgUser | undefined;
  reply(text: string, extra?: unknown): Promise<unknown>;
  answerCbQuery(text?: string): Promise<unknown>;
  editMessageReplyMarkup(markup: unknown): Promise<unknown>;
  message?: { text?: string };
  callbackQuery?: { data?: string };
}

async function replyAccessExpired(ctx: BotContext): Promise<void> {
  await ctx.reply(msg.accessExpired);
}

export async function routeUpdate(
  update: Update,
  sendMessage: (chatId: number, text: string, extra?: unknown) => Promise<void>,
  buildCtx: (update: Update) => BotContext,
): Promise<void> {
  const ctx = buildCtx(update);

  if ('message' in update && update.message) {
    const message = update.message;
    const from = ctx.from;
    if (!from) return;

    const telegramId = BigInt(from.id);
    const sessionState = await getSession(telegramId);

    if ('document' in message && message.document) {
      const doc = message.document as {
        file_id: string;
        file_name?: string;
        file_size?: number;
      };
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
      [msg.menuHelp]: 'help',
      [msg.menuHistory]: 'history',
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
      await handleStart(ctx as Parameters<typeof handleStart>[0]);
      return;
    }

    const ADMIN_COMMANDS = new Set([
      'view_profiles',
      'activate_profile',
      'deprecate_profile',
      'view_errors',
      'stats',
      'retry_export',
    ]);

    if (ADMIN_COMMANDS.has(command)) {
      if (!isAdmin(telegramId)) {
        await ctx.reply(msg.adminNotAuthorized);
        return;
      }
      switch (command) {
        case 'view_profiles':
          await handleViewProfiles(ctx as Parameters<typeof handleViewProfiles>[0]);
          break;
        case 'activate_profile':
          await handleActivateProfile(ctx as Parameters<typeof handleActivateProfile>[0]);
          break;
        case 'deprecate_profile':
          await handleDeprecateProfile(ctx as Parameters<typeof handleDeprecateProfile>[0]);
          break;
        case 'view_errors':
          await handleViewErrors(ctx as Parameters<typeof handleViewErrors>[0]);
          break;
        case 'stats':
          await handleStats(ctx as Parameters<typeof handleStats>[0]);
          break;
        case 'retry_export':
          await handleRetryExport(ctx as Parameters<typeof handleRetryExport>[0]);
          break;
      }
      return;
    }

    const user = await findUserByTelegramId(telegramId);
    if (!user) {
      await handleStart(ctx as Parameters<typeof handleStart>[0]);
      return;
    }

    const access = checkAccess(user);
    if (access !== 'full' && PROTECTED_COMMANDS.has(command)) {
      await replyAccessExpired(ctx);
      return;
    }

    switch (command) {
      case 'new_reconciliation':
        await handleNewReconciliation(ctx as Parameters<typeof handleNewReconciliation>[0], user.id);
        break;
      case 'subscribe':
        await handleSubscribe(ctx as Parameters<typeof handleSubscribe>[0]);
        break;
      case 'help':
        await handleHelp(ctx as Parameters<typeof handleHelp>[0]);
        break;
      case 'history':
        await handleHistory(ctx as Parameters<typeof handleHistory>[0]);
        break;
      case 'delete_my_data':
        await handleDeleteMyData(ctx as Parameters<typeof handleDeleteMyData>[0]);
        break;
      case 'get_report':
        await handleGetReport(ctx as Parameters<typeof handleGetReport>[0]);
        break;
      case 'status':
        await handleStatus(ctx as Parameters<typeof handleStatus>[0]);
        break;
      case 'sync_status':
        await import('./handlers/syncStatus').then(m => m.handleSyncStatus(ctx as any));
        break;
      case 'retry_import':
        await handleRetryImport(ctx as Parameters<typeof handleRetryImport>[0]);
        break;
      case 'cancel':
        await handleCancel(ctx as Parameters<typeof handleCancel>[0]);
        break;
      case 'upload_wb':
      case 'upload_bank':
      case 'run_sync':
        await ctx.reply('Используйте кнопки в чате для выполнения этой операции.');
        break;
      default:
        break;
    }
  }

  if ('callback_query' in update && update.callback_query) {
    const cbq = update.callback_query;
    const data = 'data' in cbq ? cbq.data : undefined;
    if (!data) return;

    switch (data) {
      case 'consent:accept':
        await handleConsentAccept(ctx as Parameters<typeof handleConsentAccept>[0]);
        break;
      case 'consent:decline':
        await handleConsentDecline(ctx as Parameters<typeof handleConsentDecline>[0]);
        break;
      case 'delete:confirm':
        await handleDeleteConfirm(ctx as Parameters<typeof handleDeleteConfirm>[0]);
        break;
      case 'delete:cancel':
        await handleDeleteCancel(ctx as Parameters<typeof handleDeleteCancel>[0]);
        break;
      case 'new_reconciliation': {
        const user = await findUserByTelegramId(BigInt(ctx.from!.id));
        if (user) await handleNewReconciliation(ctx as any, user.id);
        break;
      }
      case 'upload_wb_inline':
        await handleUploadWbInline(ctx as any);
        break;
      case 'replace_wb':
        await handleReplaceWb(ctx as any);
        break;
      case 'upload_bank_inline':
        await handleUploadBankInline(ctx as any);
        break;
      case 'replace_bank':
        await handleReplaceBank(ctx as any);
        break;
      case 'run_sync_inline':
        await handleRunSyncInline(ctx as any);
        break;
    }
  }
}
