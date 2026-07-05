import type { Context } from 'telegraf';
import { msg } from '../messages.ru';
import { setSession, clearSession } from '../session';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import {
  createCabinet,
  findCabinetsByUserId,
  findCabinetById,
  countCabinetsByUserId,
  softDeleteCabinet,
  type WbCabinet,
} from '@/src/db/repositories/wb-cabinets';
import { cabinetLimitFor, hasBusinessFeatures } from '@/src/lib/billing/tariffs';

const MAX_NAME_LEN = 64;

function cabinetsKeyboard(cabinets: WbCabinet[], canAdd: boolean, showUpgrade: boolean) {
  const rows: { text: string; callback_data: string }[][] = cabinets.map((c) => [
    { text: `🗑 ${c.name}`, callback_data: `cabinet_del:${c.id}` },
  ]);
  if (canAdd) rows.push([{ text: msg.addCabinetButton, callback_data: 'cabinet_add' }]);
  if (showUpgrade) rows.push([{ text: msg.upgradeToBusinessButton, callback_data: 'tariff_business' }]);
  return { reply_markup: { inline_keyboard: rows } };
}

export async function handleMyCabinets(ctx: Context): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;
  const cabinets = await findCabinetsByUserId(user.id);
  const limit = cabinetLimitFor(user.tariff);
  const canAdd = cabinets.length < limit;
  // Кнопку апгрейда показываем, когда лимит упёрся и это не BUSINESS
  const showUpgrade = !canAdd && !hasBusinessFeatures(user.tariff);
  const header = cabinets.length > 0
    ? msg.myCabinetsHeader(cabinets.length, limit)
    : msg.myCabinetsEmpty(limit);
  await ctx.reply(header, cabinetsKeyboard(cabinets, canAdd, showUpgrade));
}

export async function handleCabinetAdd(ctx: Context): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;
  const [count, limit] = [await countCabinetsByUserId(user.id), cabinetLimitFor(user.tariff)];
  if (count >= limit) {
    if (hasBusinessFeatures(user.tariff)) {
      await ctx.reply(msg.cabinetLimitBusiness(limit));
    } else {
      await ctx.reply(msg.cabinetLimitUpgrade, {
        reply_markup: {
          inline_keyboard: [[{ text: msg.upgradeToBusinessButton, callback_data: 'tariff_business' }]],
        },
      });
    }
    return;
  }
  await setSession(BigInt(ctx.from!.id), 'awaiting_cabinet_name', {});
  await ctx.reply(msg.cabinetAddPrompt);
}

/** Вызывается из router.ts, когда state === 'awaiting_cabinet_name'. */
export async function handleCabinetNameReceived(ctx: Context, rawName: string): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;
  const name = rawName.trim();
  if (!name || name.length > MAX_NAME_LEN) {
    await ctx.reply(msg.cabinetNameInvalid);
    return; // остаёмся в awaiting_cabinet_name
  }
  // Повторная проверка лимита — защита от гонки двух сообщений
  const [count, limit] = [await countCabinetsByUserId(user.id), cabinetLimitFor(user.tariff)];
  if (count >= limit) {
    await clearSession(BigInt(ctx.from!.id));
    await ctx.reply(hasBusinessFeatures(user.tariff) ? msg.cabinetLimitBusiness(limit) : msg.cabinetLimitUpgrade);
    return;
  }
  try {
    await createCabinet({ user_id: user.id, name });
  } catch (err) {
    // Уникальный индекс (user_id, name) → дубликат имени
    console.error('[myCabinets] createCabinet error:', err);
    await ctx.reply(msg.cabinetDuplicate);
    return;
  }
  await clearSession(BigInt(ctx.from!.id));
  await ctx.reply(msg.cabinetAdded(name));
  await handleMyCabinets(ctx);
}

export async function handleCabinetDelete(ctx: Context, cabinetId: string): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;
  const cabinet = await findCabinetById(cabinetId);
  // Ownership-проверка обязательна: id приходит из callback_data
  if (!cabinet || cabinet.user_id !== user.id) {
    await ctx.reply(msg.cabinetNotFound);
    return;
  }
  await softDeleteCabinet(cabinetId);
  await ctx.reply(msg.cabinetDeleted(cabinet.name));
  await handleMyCabinets(ctx);
}
