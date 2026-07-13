// pages/api/bot/webhook.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Update, User as TgUser } from 'telegraf/types';
import { requireTelegramSecret } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { findUserByTelegramId, updateUser } from '@/src/db/repositories/users';
import { handleStart } from '@/src/lib/telegram/handlers/start';
import { drainQueue } from '@/src/lib/jobs/runner';
import { runBackground } from '@/src/lib/jobs/background';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, hint: 'telegram webhook endpoint (POST only)' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    // Вместо routeUpdate пробуем вызвать handleStart напрямую для /start
    if ('message' in update && update.message && 'text' in update.message) {
      const text = update.message.text.trim();
      if (text === '/start' || text.startsWith('/start ')) {
        const ctx = buildStartCtx(update);
        await handleStart(ctx as any, undefined);
      } else {
        // Заглушка для остальных команд
        const chatId = extractChatId(update);
        if (chatId && process.env.TELEGRAM_BOT_TOKEN) {
          await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: 'Бот работает в режиме диагностики' }),
          });
        }
      }
    }
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

function adaptToNextRequest(req: NextApiRequest): any {
  return {
    headers: {
      get: (name: string) => req.headers[name.toLowerCase()] as string | undefined,
    },
  };
}

function buildStartCtx(update: Update): any {
  const from = extractFrom(update);
  const chatId = extractChatId(update);
  const token = process.env.TELEGRAM_BOT_TOKEN;

  return {
    from,
    message: 'message' in update ? update.message : undefined,
    reply: async (text: string, extra?: any) => {
      if (!chatId || !token) return;
      const body: any = { chat_id: chatId, text };
      if (extra?.reply_markup) body.reply_markup = extra.reply_markup;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    answerCbQuery: async () => {},
  };
}
