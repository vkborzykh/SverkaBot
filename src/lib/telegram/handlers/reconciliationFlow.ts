import type { Context } from 'telegraf';
import { setSession, getSessionPayload, updateSessionPayload, clearSession } from '../session';
import { newReconciliationKeyboard, uploadWbInlineKeyboard, wbCompletedKeyboard, bankCompletedKeyboard, reconciliationFinishedKeyboard } from '../keyboard';
import { msg } from '../messages.ru';
import { findUserByTelegramId, updateUser } from '@/src/db/repositories/users';
import { checkAccess } from '@/src/lib/telegram/access';
import { enqueue } from '@/src/lib/jobs/queue';
import { startReconciliation } from '@/src/lib/reconciliation/startRun';
import { monthlyLimitFor } from '@/src/lib/billing/tariffs';

function paywallReply(ctx: Context, text: string) {
  return ctx.reply(text, {
    reply_markup: {
      inline_keyboard: [[{ text: '💰 Подписка', callback_data: 'subscribe_inline' }]],
    },
  });
}

export async function handleNewReconciliation(ctx: Context, userId: string): Promise<void> {
  // Проверка доступа
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || checkAccess(user) !== 'full') {
    await paywallReply(ctx, msg.accessExpired);
    return;
  }
  await setSession(BigInt(ctx.from!.id), 'reconciliation_active', {});
  await ctx.reply(msg.newReconciliationPrompt, uploadWbInlineKeyboard);
}

export async function handleUploadWbInline(ctx: Context): Promise<void> {
  // Проверка доступа
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

  // Лимит сверок применяется только к оплаченной подписке (TRIAL — без лимита).
  // monthlyLimitFor: START → 4, PRO/BUSINESS → null (безлимит).
  // BUSINESS автоматически проходит везде, где проходит PRO.
  const limit = user.subscription_status === 'ACTIVE' ? monthlyLimitFor(user.tariff) : null;
  const used = user.monthly_reconciliations ?? 0;
  if (limit !== null && used >= limit) {
    await ctx.reply(msg.startLimitReached(limit), {
      reply_markup: {
        inline_keyboard: [[{ text: msg.upgradeToProButton, callback_data: 'tariff_pro' }]],
      },
    });
    return;
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
    // Списываем попытку только после успешного старта сверки —
    // неудачные запуски не тратят лимит тарифа «Старт».
    if (limit !== null) {
      await updateUser(user.id, { monthly_reconciliations: used + 1 });
    }
    await ctx.reply(msg.syncStarted);
  } catch (err) {
    console.error('[runSyncInline] error:', err);
    await ctx.reply('Произошла ошибка при запуске сверки.');
  }
}
