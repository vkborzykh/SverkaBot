import type { Context } from 'telegraf';
import { setSession, getSessionPayload, updateSessionPayload, clearSession } from '../session';
import { mainMenuKeyboard, newReconciliationKeyboard, uploadWbInlineKeyboard, wbCompletedKeyboard, bankCompletedKeyboard, reconciliationFinishedKeyboard } from '../keyboard';
import { msg } from '../messages.ru';
import { findImportsByUserId, updateImport } from '@/src/db/repositories/imports';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { enqueue } from '@/src/lib/jobs/queue';
import { startReconciliation } from '@/src/lib/reconciliation/startRun';

export async function handleNewReconciliation(ctx: Context, userId: string): Promise<void> {
  await setSession(BigInt(ctx.from!.id), 'reconciliation_active', {});
  await ctx.reply(msg.newReconciliationPrompt, uploadWbInlineKeyboard);
}

// Обработчик inline-кнопки "📊 Загрузить WB отчёт"
export async function handleUploadWbInline(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const from = ctx.from!;
  const telegramId = BigInt(from.id);
  // Проверяем, есть ли уже загруженный WB
  const payload = await getSessionPayload(telegramId);
  if (payload?.wb_import_id) {
    await ctx.reply(msg.wbAlreadyUploaded);
    return;
  }
  // Устанавливаем сессию ожидания файла
  await setSession(telegramId, 'awaiting_wb_file', payload ?? {});
  await ctx.reply(msg.uploadWbPrompt);
}

// Обработчик замены WB
export async function handleReplaceWb(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId);
  if (payload?.wb_import_id) {
    // Удаляем старый импорт (меняем статус на CANCELLED или физически удаляем, здесь просто убираем из сессии)
    await updateSessionPayload(telegramId, { ...payload, wb_import_id: undefined });
  }
  await setSession(telegramId, 'awaiting_wb_file', payload ?? {});
  await ctx.reply(msg.uploadWbPrompt);
}

// Обработчик inline-кнопки "🏦 Загрузить выписку"
export async function handleUploadBankInline(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId);
  if (payload?.bank_import_id) {
    await ctx.reply(msg.bankAlreadyUploaded);
    return;
  }
  await setSession(telegramId, 'awaiting_bank_file', payload ?? {});
  await ctx.reply(msg.uploadBankPrompt);
}

// Замена выписки
export async function handleReplaceBank(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const telegramId = BigInt(ctx.from!.id);
  const payload = await getSessionPayload(telegramId);
  if (payload?.bank_import_id) {
    await updateSessionPayload(telegramId, { ...payload, bank_import_id: undefined });
  }
  await setSession(telegramId, 'awaiting_bank_file', payload ?? {});
  await ctx.reply(msg.uploadBankPrompt);
}

// Запуск сверки по inline-кнопке
export async function handleRunSyncInline(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const telegramId = BigInt(ctx.from!.id);
  const user = await findUserByTelegramId(telegramId);
  if (!user) {
    await ctx.reply(msg.accessExpired);
    return;
  }

  const payload = await getSessionPayload(telegramId);
  const wbImportId = payload?.wb_import_id as string | undefined;
  const bankImportId = payload?.bank_import_id as string | undefined;

  if (!wbImportId || !bankImportId) {
    await ctx.reply(msg.syncNeedBothFiles);
    return;
  }

  try {
    const result = await startReconciliation({ userId: user.id, wbImportId, bankImportId });
    if ('error' in result) {
      await ctx.reply('Не удалось запустить сверку. Проверьте файлы и попробуйте снова.');
      return;
    }
    await enqueue('reconcile', result.run_id, { run_id: result.run_id });
    await ctx.reply(msg.syncStarted);
  } catch (err) {
    console.error('[runSyncInline] error:', err);
    await ctx.reply('Произошла ошибка при запуске сверки.');
  }
}
