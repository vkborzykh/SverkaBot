import type { Context } from 'telegraf';
import { msg } from '../messages.ru';
import { setSession, clearSession } from '../session';
import { findUserByTelegramId, updateUser } from '@/src/db/repositories/users';
import {
  createCabinet,
  findCabinetsByUserId,
  findCabinetById,
  countCabinetsByUserId,
  softDeleteCabinet,
  type WbCabinet,
} from '@/src/db/repositories/wb-cabinets';
import { cabinetLimitFor, hasBusinessFeatures, hasProFeatures } from '@/src/lib/billing/tariffs';

const MAX_NAME_LEN = 64;

function cabinetsKeyboard(
  cabinets: WbCabinet[],
  canAdd: boolean,
  showUpgrade: boolean,
  isBusiness: boolean,
  currentCabinetId?: string | null,
) {
  const rows: { text: string; callback_data: string }[][] = [];
  for (const c of cabinets) {
    const isCurrent = c.id === currentCabinetId;
    const label = `${isCurrent ? '✅ ' : ''}${c.name}`;
    rows.push([
      { text: label, callback_data: `cabinet_use:${c.id}` },
      { text: '🗑', callback_data: `cabinet_del:${c.id}` },
    ]);
  }
  if (canAdd) {
    rows.push([{ text: msg.addCabinetButton, callback_data: 'cabinet_add' }]);
  }
  if (isBusiness) {
    rows.push([{ text: '📊 Сводный отчёт (все кабинеты)', callback_data: 'summary_period_pick:all' }]);
  }
  if (showUpgrade) {
    rows.push([{ text: msg.upgradeToBusinessButton, callback_data: 'tariff_business' }]);
  }
  return { reply_markup: { inline_keyboard: rows } };
}

export async function handleMyCabinets(ctx: Context): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;

  // Передаём статус подписки и дату окончания триала, чтобы TRIAL давал доступ
  if (!hasProFeatures(user.tariff, user.subscription_status, user.trial_expires_at)) {
    await ctx.reply('Мультикабинет доступен на тарифах «Профи» и «Бизнес».', {
      reply_markup: {
        inline_keyboard: [[{ text: '⚡ Перейти на Профи', callback_data: 'tariff_pro' }]],
      },
    });
    return;
  }

  const cabinets = await findCabinetsByUserId(user.id);
  const limit = cabinetLimitFor(user.tariff, user.subscription_status, user.trial_expires_at);
  const canAdd = cabinets.length < limit;
  const showUpgrade = !canAdd && !hasBusinessFeatures(user.tariff, user.subscription_status, user.trial_expires_at);
  const isBusiness = hasBusinessFeatures(user.tariff, user.subscription_status, user.trial_expires_at);
  const header =
    cabinets.length > 0
      ? msg.myCabinetsHeader(cabinets.length, limit)
      : msg.myCabinetsEmpty(limit);
  await ctx.reply(header, cabinetsKeyboard(cabinets, canAdd, showUpgrade, isBusiness, user.current_cabinet_id));
}

export async function handleCabinetUse(ctx: Context, cabinetId: string): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;
  const cabinet = await findCabinetById(cabinetId);
  if (!cabinet || cabinet.user_id !== user.id) {
    await ctx.reply(msg.cabinetNotFound);
    return;
  }
  await updateUser(user.id, { current_cabinet_id: cabinetId });
  await ctx.reply(msg.cabinetSelected(cabinet.name));
  await handleMyCabinets(ctx);
}

export async function handleCabinetAdd(ctx: Context): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;
  const [count, limit] = [
    await countCabinetsByUserId(user.id),
    cabinetLimitFor(user.tariff, user.subscription_status, user.trial_expires_at)
  ];
  if (count >= limit) {
    if (hasBusinessFeatures(user.tariff, user.subscription_status, user.trial_expires_at)) {
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

export async function handleCabinetNameReceived(ctx: Context, rawName: string): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;
  const name = rawName.trim();
  if (!name || name.length > MAX_NAME_LEN) {
    await ctx.reply(msg.cabinetNameInvalid);
    return;
  }
  const [count, limit] = [
    await countCabinetsByUserId(user.id),
    cabinetLimitFor(user.tariff, user.subscription_status, user.trial_expires_at)
  ];
  if (count >= limit) {
    await clearSession(BigInt(ctx.from!.id));
    await ctx.reply(
      hasBusinessFeatures(user.tariff, user.subscription_status, user.trial_expires_at)
        ? msg.cabinetLimitBusiness(limit)
        : msg.cabinetLimitUpgrade
    );
    return;
  }
  try {
    const newCab = await createCabinet({ user_id: user.id, name });
    if (!user.current_cabinet_id && count === 0) {
      await updateUser(user.id, { current_cabinet_id: newCab.id });
    }
  } catch (err) {
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
  if (!cabinet || cabinet.user_id !== user.id) {
    await ctx.reply(msg.cabinetNotFound);
    return;
  }
  await softDeleteCabinet(cabinetId);
  if (user.current_cabinet_id === cabinetId) {
    await updateUser(user.id, { current_cabinet_id: null });
  }
  await ctx.reply(msg.cabinetDeleted(cabinet.name));
  await handleMyCabinets(ctx);
}
