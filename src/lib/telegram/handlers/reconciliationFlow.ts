import type { Context } from 'telegraf';
import { setSession, getSessionPayload, updateSessionPayload, clearSession } from '../session';
import { newReconciliationKeyboard, uploadWbInlineKeyboard, wbCompletedKeyboard, bankCompletedKeyboard, reconciliationFinishedKeyboard } from '../keyboard';
import { msg } from '../messages.ru';
import { findUserByTelegramId, updateUser } from '@/src/db/repositories/users';
import { checkAccess } from '@/src/lib/telegram/access';
import { enqueue } from '@/src/lib/jobs/queue';
import { startReconciliation } from '@/src/lib/reconciliation/startRun';
import { monthlyLimitFor } from '@/src/lib/billing/tariffs';
import { findCabinetsByUserId, findCabinetById, createCabinet } from '@/src/db/repositories/wb-cabinets';
import { getDb } from '@/src/db';
import { reconciliation_runs } from '@/src/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

function paywallReply(ctx: Context, text: string) {
  return ctx.reply(text, {
    reply_markup: {
      inline_keyboard: [[{ text: '💰 Подписка', callback_data: 'subscribe_inline' }]],
    },
  });
}

/** Проверяет, не исчерпан ли лимит сверок. Возвращает true, если продолжать нельзя. */
function checkLimitAndReply(user: any, ctx: Context): boolean {
  const limit = monthlyLimitFor(user.tariff, user.subscription_status, user.trial_expires_at);
  if (limit === null) return false; // безлимит
  const used = user.monthly_reconciliations ?? 0;
  if (used >= limit) {
    const message = user.subscription_status === 'TRIAL' ? msg.trialLimitReached(limit) : msg.startLimitReached(limit);
    ctx.reply(message, {
      reply_markup: {
        inline_keyboard: [[{ text: msg.upgradeToProButton, callback_data: 'subscribe_inline' }]],
      },
    });
    return true;
  }
  return false;
}

export async function handleNewReconciliation(ctx: Context, userId: string): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || checkAccess(user) !== 'full') {
    await paywallReply(ctx, msg.accessExpired);
    return;
  }
  if (checkLimitAndReply(user, ctx)) return;

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

  let cabinetId: string | null = cabinets.length === 1 ? cabinets[0].id : null;

  if (!cabinetId) {
    try {
      const newCab = await createCabinet({ user_id: userId, name: 'Основной' });
      await updateUser(userId, { current_cabinet_id: newCab.id });
      cabinetId = newCab.id;
    } catch (e) {
      console.error('[handleNewReconciliation] auto-create cabinet failed:', e);
      await ctx.reply('Произошла ошибка при создании кабинета. Попробуйте позже.');
      return;
    }
  }

  const payload = { cabinet_id: cabinetId };
  await setSession(BigInt(ctx.from!.id), 'reconciliation_active', payload);
  await ctx.reply(msg.newReconciliationPrompt, uploadWbInlineKeyboard);
}

export async function handleCabinetPick(ctx: Context, cabinetId: string): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || checkAccess(user) !== 'full') {
    await paywallReply(ctx, msg.accessExpired);
    return;
  }
  if (checkLimitAndReply(user, ctx)) return;

  const cabinet = await findCabinetById(cabinetId);
  if (!cabinet || cabinet.user_id !== user.id) {
    await ctx.reply(msg.cabinetNotFound);
    return;
  }
  await updateUser(user.id, { current_cabinet_id: cabinetId });
  await setSession(BigInt(ctx.from!.id), 'reconciliation_active', { cabinet_id: cabinet.id });
  await ctx.reply(msg.cabinetSelected(cabinet.name));
  await ctx.reply(msg.newReconciliationPrompt, uploadWbInlineKeyboard);
}

export async function handleUploadWbInline(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || checkAccess(user) !== 'full') {
    await paywallReply(ctx, msg.accessExpired);
    return;
  }
  if (checkLimitAndReply(user, ctx)) return;

  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId) ?? {};
  await setSession(telegramId, 'awaiting_wb_file', payload);
  await ctx.reply(msg.uploadWbPrompt);
}

export async function handleReplaceWb(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || checkAccess(user) !== 'full') {
    await paywallReply(ctx, msg.accessExpired);
    return;
  }
  if (checkLimitAndReply(user, ctx)) return;

  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId) ?? {};
  delete payload.wb_import_id;
  await setSession(telegramId, 'awaiting_wb_file', payload);
  await ctx.reply(msg.uploadWbPrompt);
}

export async function handleUploadBankInline(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || checkAccess(user) !== 'full') {
    await paywallReply(ctx, msg.accessExpired);
    return;
  }
  if (checkLimitAndReply(user, ctx)) return;

  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId) ?? {};
  await setSession(telegramId, 'awaiting_bank_file', payload);
  await ctx.reply(msg.uploadBankPrompt);
}

export async function handleReplaceBank(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || checkAccess(user) !== 'full') {
    await paywallReply(ctx, msg.accessExpired);
    return;
  }
  if (checkLimitAndReply(user, ctx)) return;

  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId) ?? {};
  delete payload.bank_import_id;
  await setSession(telegramId, 'awaiting_bank_file', payload);
  await ctx.reply(msg.uploadBankPrompt);
}

export async function handleRunSyncInline(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || checkAccess(user) !== 'full') {
    await paywallReply(ctx, msg.accessExpired);
    return;
  }

  const used = user.monthly_reconciliations ?? 0;
  const limit = monthlyLimitFor(user.tariff, user.subscription_status, user.trial_expires_at);

  if (limit !== null && used >= limit) {
    const message = user.subscription_status === 'TRIAL' ? msg.trialLimitReached(limit) : msg.startLimitReached(limit);
    await ctx.reply(message, {
      reply_markup: {
        inline_keyboard: [[{ text: msg.upgradeToProButton, callback_data: 'subscribe_inline' }]],
      },
    });
    return;
  }

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

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const db = getDb();
    const existingCompleted = await db
      .select({ id: reconciliation_runs.id })
      .from(reconciliation_runs)
      .where(
        and(
          eq(reconciliation_runs.user_id, user.id),
          eq(reconciliation_runs.wb_import_id, wbImportId),
          eq(reconciliation_runs.bank_import_id, bankImportId),
          eq(reconciliation_runs.status, 'COMPLETED'),
          gte(reconciliation_runs.created_at, startOfMonth),
          lte(reconciliation_runs.created_at, endOfMonth)
        )
      )
      .limit(1);

    if (existingCompleted.length === 0) {
      await updateUser(user.id, { monthly_reconciliations: used + 1 });
    }

    const currentUsed = existingCompleted.length === 0 ? used + 1 : used;
    const remaining = limit !== null ? limit - currentUsed : null;

    if (remaining !== null && remaining >= 0) {
      await ctx.reply(`✅ Сверка запущена. Осталось ${remaining} из ${limit} сверок.`);
    } else {
      await ctx.reply(msg.syncStarted);
    }
  } catch (err) {
    console.error('[runSyncInline] error:', err);
    await ctx.reply('Произошла ошибка при запуске сверки.');
  }
}
