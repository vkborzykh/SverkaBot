import type { Context } from 'telegraf';
import { setSession, getSessionPayload, updateSessionPayload, clearSession } from '../session';
import { newReconciliationKeyboard, uploadWbInlineKeyboard, wbCompletedKeyboard, bankCompletedKeyboard, reconciliationFinishedKeyboard } from '../keyboard';
import { msg } from '../messages.ru';
import { findUserByTelegramId, updateUser } from '@/src/db/repositories/users';
import { checkAccess } from '@/src/lib/telegram/access';
import { enqueue } from '@/src/lib/jobs/queue';
import { startReconciliation } from '@/src/lib/reconciliation/startRun';
import { monthlyLimitFor } from '@/src/lib/billing/tariffs';
import { findCabinetsByUserId, findCabinetById } from '@/src/db/repositories/wb-cabinets';

const TRIAL_LIMIT = 3;

function paywallReply(ctx: Context, text: string) {
  return ctx.reply(text, {
    reply_markup: {
      inline_keyboard: [[{ text: '💰 Подписка', callback_data: 'subscribe_inline' }]],
    },
  });
}

export async function handleNewReconciliation(ctx: Context, userId: string): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || checkAccess(user) !== 'full') {
    await paywallReply(ctx, msg.accessExpired);
    return;
  }

  // Если у пользователя больше одного кабинета — выбор кнопками
  const cabinets = await findCabinetsByUserId(user.id);
  if (cabinets.length > 1) {
    await setSession(BigInt(ctx.from!.id), 'choosing_cabinet', {});
    await ctx.reply(msg.cabinetChoosePrompt, {
      reply_markup: {
        inline_keyboard: cabinets.map((c) => [
          { text: `${c.id === user.current_cabinet_id ? '✅ ' : ''}${c.name}`, callback_data: `cabinet_pick:${c.id}` },
        ]),
      },
    });
    return;
  }

  // Один кабинет или ноль
  const cabinetId = cabinets.length === 1 ? cabinets[0].id : null;
  const payload = cabinetId ? { cabinet_id: cabinetId } : {};
  await setSession(BigInt(ctx.from!.id), 'reconciliation_active', payload);
  await ctx.reply(msg.newReconciliationPrompt, uploadWbInlineKeyboard);
}

export async function handleCabinetPick(ctx: Context, cabinetId: string): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || checkAccess(user) !== 'full') {
    await paywallReply(ctx, msg.accessExpired);
    return;
  }
  const cabinet = await findCabinetById(cabinetId);
  if (!cabinet || cabinet.user_id !== user.id) {
    await ctx.answerCbQuery?.();
    await ctx.reply(msg.cabinetNotFound);
    return;
  }
  await ctx.answerCbQuery?.();
  // Обновляем current_cabinet_id у пользователя
  await updateUser(user.id, { current_cabinet_id: cabinetId });
  await setSession(BigInt(ctx.from!.id), 'reconciliation_active', { cabinet_id: cabinet.id });
  await ctx.reply(msg.cabinetSelected(cabinet.name));
  await ctx.reply(msg.newReconciliationPrompt, uploadWbInlineKeyboard);
}

export async function handleUploadWbInline(ctx: Context): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || checkAccess(user) !== 'full') {
    await paywallReply(ctx, msg.accessExpired);
    return;
  }
  await ctx.answerCbQuery();
  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId) ?? {};
  await setSession(telegramId, 'awaiting_wb_file', payload);
  await ctx.reply(msg.uploadWbPrompt);
}

export async function handleReplaceWb(ctx: Context): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || checkAccess(user) !== 'full') {
    await paywallReply(ctx, msg.accessExpired);
    return;
  }
  await ctx.answerCbQuery();
  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId) ?? {};
  delete payload.wb_import_id;
  await setSession(telegramId, 'awaiting_wb_file', payload);
  await ctx.reply(msg.uploadWbPrompt);
}

export async function handleUploadBankInline(ctx: Context): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || checkAccess(user) !== 'full') {
    await paywallReply(ctx, msg.accessExpired);
    return;
  }
  await ctx.answerCbQuery();
  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId) ?? {};
  await setSession(telegramId, 'awaiting_bank_file', payload);
  await ctx.reply(msg.uploadBankPrompt);
}

export async function handleReplaceBank(ctx: Context): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || checkAccess(user) !== 'full') {
    await paywallReply(ctx, msg.accessExpired);
    return;
  }
  await ctx.answerCbQuery();
  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId) ?? {};
  delete payload.bank_import_id;
  await setSession(telegramId, 'awaiting_bank_file', payload);
  await ctx.reply(msg.uploadBankPrompt);
}

export async function handleRunSyncInline(ctx: Context): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || checkAccess(user) !== 'full') {
    await paywallReply(ctx, msg.accessExpired);
    return;
  }

  const used = user.monthly_reconciliations ?? 0;

  if (user.subscription_status === 'TRIAL') {
    if (used >= TRIAL_LIMIT) {
      await ctx.reply(msg.trialLimitReached(TRIAL_LIMIT), {
        reply_markup: {
          inline_keyboard: [[{ text: '💰 Подписка', callback_data: 'subscribe_inline' }]],
        },
      });
      return;
    }
  }

  if (user.subscription_status === 'ACTIVE') {
    const limit = monthlyLimitFor(user.tariff);
    if (limit !== null && used >= limit) {
      await ctx.reply(msg.startLimitReached(limit), {
        reply_markup: {
          inline_keyboard: [[{ text: msg.upgradeToProButton, callback_data: 'tariff_pro' }]],
        },
      });
      return;
    }
  }

  await ctx.answerCbQuery();
  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId) ?? {};
  const wbImportId = payload.wb_import_id as string | undefined;
  const bankImportId = payload.bank_import_id as string | undefined;
  if (!wbImportId || !bankImportId) {
    await ctx.reply(msg.syncNeedBothFiles);
    return;
  }
  try {
    const result = await startReconciliation({ userId: user.id, wbImportId, bankImportId });
    if ('error' in result) {
      if (result.error.code === 'PERIOD_MISMATCH') {
        await ctx.reply(msg.syncPeriodMismatch);
      } else {
        await ctx.reply('Не удалось запустить сверку. Проверьте файлы и попробуйте снова.');
      }
      return;
    }
    await enqueue('reconcile', result.run_id, { run_id: result.run_id });
    if (user.subscription_status === 'TRIAL' || (user.subscription_status === 'ACTIVE' && monthlyLimitFor(user.tariff) !== null)) {
      await updateUser(user.id, { monthly_reconciliations: used + 1 });
    }
    if (user.subscription_status === 'TRIAL') {
      const remaining = TRIAL_LIMIT - (used + 1);
      if (remaining > 0) {
        await ctx.reply(`✅ Сверка запущена. Осталось ${remaining} из ${TRIAL_LIMIT} пробных сверок.`);
      } else {
        await ctx.reply(msg.syncStarted);
      }
    } else {
      await ctx.reply(msg.syncStarted);
    }
  } catch (err) {
    console.error('[runSyncInline] error:', err);
    await ctx.reply('Произошла ошибка при запуске сверки.');
  }
}
