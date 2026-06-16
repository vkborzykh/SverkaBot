import type { Update, User as TgUser } from 'telegraf/types';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { checkAccess, PROTECTED_COMMANDS } from './access';
import { getSession, clearSession } from './session';
import { handleStart, handleConsentAccept, handleConsentDecline } from './handlers/start';
import { handleLossCalculator, handleTurnoverInput } from './handlers/loss-calculator';
import {
  handleUploadWbCommand,
  handleUploadBankCommand,
  handleWbFileReceived,
  handleBankFileReceived,
  type DocumentInfo,
} from './handlers/upload';
import {
  handleHistory,
  handleHelp,
  handleGetReport,
  handleStatus,
} from './handlers/stubs';
import { handleDeleteMyData, handleDeleteConfirm, handleDeleteCancel } from './handlers/deleteData';
import { handleSubscribe } from './handlers/subscribe';
import { handleRunSync } from './handlers/runSync';
import { handleSyncStatus } from './handlers/syncStatus';
import {
  isAdmin,
  handleViewProfiles,
  handleActivateProfile,
  handleDeprecateProfile,
  handleViewErrors,
  handleStats,
  handleRetryExport,
} from './handlers/admin';
import { msg } from './messages.ru';

// Minimal context shape for our handlers — avoids importing full Telegraf in the route
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

    // Handle document uploads based on awaiting state
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
      // Document received without an active session — ignore silently
      return;
    }

    if (!('text' in message) || !message.text) return;

    const text = message.text.trim();

    // Check in-session text input first
    if (sessionState === 'awaiting_turnover') {
      await handleTurnoverInput(ctx as Parameters<typeof handleTurnoverInput>[0]);
      return;
    }

    // Map menu button labels to commands
    const commandMap: Record<string, string> = {
      [msg.menuUploadWb]: 'upload_wb',
      [msg.menuUploadBank]: 'upload_bank',
      [msg.menuRunSync]: 'run_sync',
      [msg.menuHistory]: 'history',
      [msg.menuSubscribe]: 'subscribe',
      [msg.menuHelp]: 'help',
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

    // Admin commands — only for users in TELEGRAM_ADMIN_IDS
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

    // Access check for non-start commands
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
      case 'upload_wb':
        await handleUploadWbCommand(ctx);
        break;
      case 'upload_bank':
        await handleUploadBankCommand(ctx);
        break;
      case 'run_sync':
        await handleRunSync(ctx as Parameters<typeof handleRunSync>[0]);
        break;
      case 'history':
        await handleHistory(ctx as Parameters<typeof handleHistory>[0]);
        break;
      case 'subscribe':
        await handleSubscribe(ctx as Parameters<typeof handleSubscribe>[0]);
        break;
      case 'help':
        await handleHelp(ctx as Parameters<typeof handleHelp>[0]);
        break;
      case 'get_report':
        await handleGetReport(ctx as Parameters<typeof handleGetReport>[0]);
        break;
      case 'status':
        await handleStatus(ctx as Parameters<typeof handleStatus>[0]);
        break;
      case 'sync_status':
        await handleSyncStatus(ctx as Parameters<typeof handleSyncStatus>[0]);
        break;
      case 'delete_my_data':
        await handleDeleteMyData(ctx as Parameters<typeof handleDeleteMyData>[0]);
        break;
      case 'loss_calculator':
        await handleLossCalculator(ctx as Parameters<typeof handleLossCalculator>[0]);
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
    }
  }
}
