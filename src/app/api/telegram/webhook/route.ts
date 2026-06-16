import { NextRequest } from 'next/server';
import type { Update, User as TgUser } from 'telegraf/types';
import { requireTelegramSecret } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { findUserByTelegramId, updateUser } from '@/src/db/repositories/users';
import { routeUpdate, type BotContext } from '@/src/lib/telegram/router';
import { drainQueue } from '@/src/lib/jobs/runner';
import { runBackground } from '@/src/lib/jobs/background';

// Вебхук обязан работать на Node.js-рантайме (postgres-js и telegraf не
// совместимы с Edge) и никогда не кэшироваться статически.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Даём время фоновой работе (waitUntil → drainQueue) завершиться после ответа.
// 60 c — потолок тарифа Hobby.
export const maxDuration = 60;

// Лёгкий health-check для ручной проверки в браузере (Telegram шлёт только POST).
export async function GET() {
  return okResponse({ ok: true, hint: 'telegram webhook endpoint (POST only)' });
}

export async function POST(req: NextRequest) {
  // 1. Проверка секретного заголовка (возвращает 401, НЕ бросает исключение).
  const guard = requireTelegramSecret(req);
  if (guard) return guard;

  // 2. Парсинг тела запроса.
  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch (err) {
    console.error('[webhook] invalid JSON body:', err);
    return errResponse('BAD_REQUEST', 'Invalid JSON', 400);
  }

  // 3-4. ВСЁ ниже обёрнуто так, чтобы при любой ошибке вернуть 200.
  // Telegram повторяет запросы при не-2xx и помечает вебхук как сбойный в
  // getWebhookInfo, поэтому ошибку логируем, но подтверждаем приём кодом 200.
  try {
    const updateId = (update as { update_id: number }).update_id;

    // Дедупликация (best-effort: сбой БД не должен блокировать обработку).
    const from = extractFrom(update);
    if (from) {
      try {
        const telegramId = BigInt(from.id);
        const user = await findUserByTelegramId(telegramId);
        if (user) {
          const lastId = user.last_update_id;
          if (lastId !== null && lastId !== undefined && BigInt(updateId) <= lastId) {
            return okResponse({ ok: true }); // дубликат — игнорируем
          }
          await updateUser(user.id, { last_update_id: BigInt(updateId) });
        }
      } catch (err) {
        console.error('[webhook] dedup/DB step failed (continuing):', err);
      }
    }

    // Основная обработка апдейта.
    await routeUpdate(update, async () => {}, buildCtx);
  } catch (err) {
    console.error('[webhook] FATAL while processing update:', err);
    // Всё равно 200 — чтобы Telegram не ретраил и getWebhookInfo был чистым.
  }

  // Оппортунистический разгрёб очереди: при любом взаимодействии пользователя
  // дотягиваем застрявшие задачи (например, повторные попытки после backoff),
  // не дожидаясь суточного крона. Безопасно благодаря FOR UPDATE SKIP LOCKED.
  runBackground(drainQueue());

  return okResponse({ ok: true });
}

// ---- helpers (именно их случайно потеряли в задеплоенной версии) ----

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
  // Telegraf Markup-объекты отдают reply_markup.
  const e = extra as Record<string, unknown>;
  if ('reply_markup' in e) return { reply_markup: e.reply_markup };
  return e;
}

function buildCtx(update: Update): BotContext {
  const from = extractFrom(update);
  const chatId = extractChatId(update);

  const sendText = async (text: string, extra?: unknown): Promise<unknown> => {
    if (!chatId) return;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error('[webhook] TELEGRAM_BOT_TOKEN is not set — cannot reply');
      return;
    }
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, ...flattenExtra(extra) }),
    });
    if (!res.ok) {
      console.error('[webhook] sendMessage failed:', res.status, await res.text());
    }
    return;
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
