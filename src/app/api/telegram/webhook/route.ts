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
  console.log("✅ 1. Webhook function invoked!");

  // 1. Проверяем секретный заголовок
  console.log("➡️ 2. Checking secret token...");
  const guard = requireTelegramSecret(req);
  if (guard) {
    console.error("❌ 3. Secret token check failed!");
    return guard;
  }
  console.log("✅ 3. Secret token check passed.");

  // 2. Парсим JSON
  let update: Update;
  try {
    console.log("➡️ 4. Parsing JSON body...");
    update = (await req.json()) as Update;
    console.log("✅ 5. JSON body parsed successfully.");
  } catch (err) {
    console.error("❌ 5. Failed to parse JSON:", err);
    return errResponse('BAD_REQUEST', 'Invalid JSON', 400);
  }

  const updateId: number = (update as { update_id: number }).update_id;

  // 3. Дедупликация (извлекаем ID пользователя)
  console.log("➡️ 6. Extracting user from update...");
  const from = extractFrom(update);
  if (from) {
    const telegramId = BigInt(from.id);
    console.log(`✅ 7. User found: ${telegramId}. Checking for duplicates...`);
    const user = await findUserByTelegramId(telegramId);
    if (user) {
      const lastId = user.last_update_id;
      if (lastId !== null && lastId !== undefined && BigInt(updateId) <= lastId) {
        console.log(`✅ 8. Duplicate update ${updateId} ignored.`);
        return okResponse({ ok: true });
      }
      await updateUser(user.id, { last_update_id: BigInt(updateId) });
      console.log(`✅ 8. User ${telegramId} last_update_id updated to ${updateId}.`);
    }
  }

  // 4. Обрабатываем само обновление (самая рискованная часть)
  console.log("➡️ 9. Processing update via routeUpdate...");
  try {
    await routeUpdate(update, async () => {}, buildCtx);
    console.log("✅ 10. routeUpdate finished successfully.");
  } catch (err) {
    console.error("🔥 10. FATAL ERROR inside routeUpdate:", err);
    // ВАЖНО: Возвращаем 200, чтобы Telegram не пытался повторять запрос,
    // и не засорял логи нашей внутренней ошибкой.
    return okResponse({ ok: true });
  }

  console.log("✅ 11. Webhook finished, returning 200.");
  return okResponse({ ok: true });
}
