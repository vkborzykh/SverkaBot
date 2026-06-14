import { NextRequest } from 'next/server';
import type { Update, User as TgUser } from 'telegraf/types';
import { requireTelegramSecret } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import {
  findUserByTelegramId,
  updateUser,
} from '@/src/db/repositories/users';
import { routeUpdate, type BotContext } from '@/src/lib/telegram/router';

export async function POST(req: NextRequest) {
  const guard = requireTelegramSecret(req);
  if (guard) return guard;

  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch {
    return errResponse('BAD_REQUEST', 'Invalid JSON', 400);
  }

  const updateId: number = (update as { update_id: number }).update_id;

  // Extract sender telegram_id for deduplication
  const from = extractFrom(update);
  if (from) {
    const telegramId = BigInt(from.id);
    const user = await findUserByTelegramId(telegramId);
    if (user) {
      const lastId = user.last_update_id;
      if (lastId !== null && lastId !== undefined && BigInt(updateId) <= lastId) {
        return okResponse({ ok: true });
      }
      await updateUser(user.id, { last_update_id: BigInt(updateId) });
    }
  }

  await routeUpdate(update, async () => {}, buildCtx);

  return okResponse({ ok: true });
}

function extractFrom(update: Update): TgUser | undefined {
  if ('message' in update && update.message && 'from' in update.message) {
    return update.message.from;
  }
  if ('callback_query' in update && update.callback_query) {
    return update.callback_query.from;
  }
  return undefined;
}

function buildCtx(update: Update): BotContext {
  const from = extractFrom(update);
  const chatId = extractChatId(update);

  const sendText = async (text: string, extra?: unknown): Promise<unknown> => {
    if (!chatId) return;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, ...flattenExtra(extra) }),
    });
  };

  const cbQueryId =
    'callback_query' in update && update.callback_query
      ? update.callback_query.id
      : undefined;

  const messageId =
    'callback_query' in update &&
    update.callback_query &&
    'message' in update.callback_query &&
    update.callback_query.message
      ? update.callback_query.message.message_id
      : undefined;

  return {
    from,
    reply: sendText,
    answerCbQuery: async (text?: string) => {
      if (!cbQueryId) return;
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) return;
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cbQueryId, text }),
      });
    },
    editMessageReplyMarkup: async (_markup: unknown) => {
      if (!chatId || !messageId) return;
      const token = process.env.TELEGRAM_BOT_TOKEN;
      if (!token) return;
      await fetch(
        `https://api.telegram.org/bot${token}/editMessageReplyMarkup`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {},
          }),
        },
      );
    },
    message:
      'message' in update && update.message && 'text' in update.message
        ? { text: update.message.text }
        : undefined,
    callbackQuery:
      'callback_query' in update && update.callback_query
        ? { data: 'data' in update.callback_query ? update.callback_query.data : undefined }
        : undefined,
  };
}

function extractChatId(update: Update): number | undefined {
  if ('message' in update && update.message && 'chat' in update.message) {
    return update.message.chat.id;
  }
  if (
    'callback_query' in update &&
    update.callback_query &&
    'message' in update.callback_query &&
    update.callback_query.message &&
    'chat' in update.callback_query.message
  ) {
    return update.callback_query.message.chat.id;
  }
  return undefined;
}

function flattenExtra(extra: unknown): Record<string, unknown> {
  if (!extra || typeof extra !== 'object') return {};
  // Telegraf Markup objects expose reply_markup
  const e = extra as Record<string, unknown>;
  if ('reply_markup' in e) return { reply_markup: e.reply_markup };
  return e;
}
