import type { Context } from 'telegraf';
import { setSession, getSessionPayload, updateSessionPayload, clearSession } from '../session';
import { newReconciliationKeyboard, uploadWbInlineKeyboard, wbCompletedKeyboard, bankCompletedKeyboard, reconciliationFinishedKeyboard } from '../keyboard';
import { msg } from '../messages.ru';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { enqueue } from '@/src/lib/jobs/queue';
import { startReconciliation } from '@/src/lib/reconciliation/startRun';

export async function handleNewReconciliation(ctx: Context, userId: string): Promise<void> {
  // Новая операция: очищаем сессию и устанавливаем активное состояние с пустыми слотами
  await setSession(BigInt(ctx.from!.id), 'reconciliation_active', {});
  await ctx.reply(msg.newReconciliationPrompt, uploadWbInlineKeyboard);
}

export async function handleUploadWbInline(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId) ?? {};
  // Устанавливаем сессию ожидания WB-файла, сохраняя текущие слоты
  await setSession(telegramId, 'awaiting_wb_file', payload);
  await ctx.reply(msg.uploadWbPrompt);
}

export async function handleReplaceWb(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId) ?? {};
  delete payload.wb_import_id;
  await setSession(telegramId, 'awaiting_wb_file', payload);
  await ctx.reply(msg.uploadWbPrompt);
}

export async function handleUploadBankInline(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId) ?? {};
  // Устанавливаем сессию ожидания банковского файла
  await setSession(telegramId, 'awaiting_bank_file', payload);
  await ctx.reply(msg.uploadBankPrompt);
}

export async function handleReplaceBank(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId) ?? {};
  delete payload.bank_import_id;
  await setSession(telegramId, 'awaiting_bank_file', payload);
  await ctx.reply(msg.uploadBankPrompt);
}

export async function handleRunSyncInline(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const telegramId = BigInt(ctx.from!.id);
  const user = await findUserByTelegramId(telegramId);
  if (!user) {
    await ctx.reply(msg.accessExpired);
    return;
  }

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
    await ctx.reply(msg.syncStarted);
  } catch (err) {
    console.error('[runSyncInline] error:', err);
    await ctx.reply('Произошла ошибка при запуске сверки.');
  }
}
