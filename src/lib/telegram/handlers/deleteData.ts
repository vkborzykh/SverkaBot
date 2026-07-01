import type { Context } from 'telegraf';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { deleteUserData } from '@/src/lib/users/deletion';
import { deleteConfirmKeyboard } from '../keyboard';
import { msg } from '../messages.ru';
import { findImportsByUserId } from '@/src/db/repositories/imports';
import { findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';

export async function handleDeleteMyData(ctx: Context): Promise<void> {
  await ctx.reply(msg.deleteConfirmPrompt, deleteConfirmKeyboard);
}

export async function handleDeleteConfirm(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();

  const from = ctx.from;
  if (!from) return;

  const user = await findUserByTelegramId(BigInt(from.id));

  // Пользователь не найден (уже удалён или анонимизирован) – нечего удалять
  if (!user) {
    try { await ctx.editMessageReplyMarkup(undefined); } catch {}
    await ctx.reply(msg.deleteNothing);
    return;
  }

  // Проверяем, есть ли вообще активные импорты или сверки
  const [imports, runs] = await Promise.all([
    findImportsByUserId(user.id, { limit: 1 }),
    findRunsByUserId(user.id, 1),
  ]);

  if (imports.length === 0 && runs.length === 0) {
    // Данных нет – сообщаем и убираем кнопки
    try { await ctx.editMessageReplyMarkup(undefined); } catch {}
    await ctx.reply(msg.deleteNothing);
    return;
  }

  // Удаляем данные
  try {
    await deleteUserData(user.id);
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(msg.deleteSuccess);
  } catch {
    try { await ctx.editMessageReplyMarkup(undefined); } catch {}
    await ctx.reply(msg.deleteError);
  }
}

export async function handleDeleteCancel(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply(msg.deleteCancelled);
}
