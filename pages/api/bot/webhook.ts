// pages/api/bot/webhook.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Update, User as TgUser } from 'telegraf/types';
import { findUserByTelegramId, updateUser } from '@/src/db/repositories/users';
import { routeUpdate, type BotContext } from '@/src/lib/telegram/router';
import { drainQueue } from '@/src/lib/jobs/runner';
import { runBackground } from '@/src/lib/jobs/background';
import { okResponse, errResponse } from '@/src/lib/http';
import { requireTelegramSecret } from '@/src/lib/guards';

// Превращаем NextApiRequest в подобие NextRequest для совместимости с guards
function adaptToNextRequest(req: NextApiRequest): any {
  return {
    headers: {
      get: (name: string) => req.headers[name.toLowerCase()] as string | undefined,
    },
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, hint: 'telegram webhook endpoint (POST only)' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Guard проверка
  const guard = requireTelegramSecret(adaptToNextRequest(req) as any);
  if (guard) {
    return res.status(401).json({ error: 'Invalid telegram secret' });
  }

  let update: Update;
  try {
    update = req.body as Update;
  } catch (err) {
    console.error('[webhook] invalid JSON body:', err);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  try {
    const updateId = (update as { update_id: number }).update_id;
    const from = extractFrom(update);
    if (from) {
      try {
        const telegramId = BigInt(from.id);
        const user = await findUserByTelegramId(telegramId);
        if (user) {
          const lastId = user.last_update_id;
          if (lastId !== null && lastId !== undefined && BigInt(updateId) <= lastId) {
            return res.status(200).json({ ok: true });
          }
          await updateUser(user.id, { last_update_id: BigInt(updateId) });
        }
      } catch (err) {
        console.error('[webhook] dedup/DB step failed (continuing):', err);
      }
    }

    await routeUpdate(update, async () => {}, buildCtx(req, update));
  } catch (err) {
    console.error('[webhook] FATAL while processing update:', err);
  }

  runBackground(drainQueue());
  return res.status(200).json({ ok: true });
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
  const e = extra as Record<string, unknown>;
  if ('reply_markup' in e) return { reply_markup: e.reply_markup };
  return e;
}

function buildCtx(req: NextApiRequest, update: Update): BotContext {
  const from = extractFrom(update);
  const chatId = extractChatId(update);
  const token = process.env.TELEGRAM_BOT_TOKEN;

  const sendText = async (text: string, extra?: unknown): Promise<unknown> => {
    if (!chatId || !token) return;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, ...flattenExtra(extra) }),
    });
    if (!res.ok) console.error('[webhook] sendMessage failed:', res.status, await res.text());
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
      if (!cbQueryId || !token) return;
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cbQueryId, text }),
      });
    },
    answerPreCheckoutQuery: async (query: { pre_checkout_query_id: string; ok: boolean; error_message?: string }) => {
      if (!token) return;
      await fetch(`https://api.telegram.org/bot${token}/answerPreCheckoutQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pre_checkout_query_id: query.pre_checkout_query_id,
          ok: query.ok,
          error_message: query.error_message,
        }),
      });
    },
    replyWithInvoice: async (invoice: any, extra?: any) => {
      if (!chatId || !token) return;
      const body: Record<string, unknown> = {
        chat_id: chatId,
        ...invoice,
      };
      if (extra) Object.assign(body, extra);
      await fetch(`https://api.telegram.org/bot${token}/sendInvoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    editMessageReplyMarkup: async (_markup: unknown) => {
      if (!chatId || !messageId || !token) return;
      await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {},
        }),
      });
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
