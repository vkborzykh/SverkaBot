import type { Context } from 'telegraf';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { deleteUserData } from '@/src/lib/users/deletion';
import { deleteConfirmKeyboard } from '../keyboard';
import { msg } from '../messages.ru';

export async function handleDeleteMyData(ctx: Context): Promise<void> {
  await ctx.reply(msg.deleteConfirmPrompt, deleteConfirmKeyboard);
}

export async function handleDeleteConfirm(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();

  const from = ctx.from;
  if (!from) return;

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) {
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(msg.deleteSuccess);
    return;
  }

  try {
    await deleteUserData(user.id);
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(msg.deleteSuccess);
  } catch {
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(msg.deleteError);
  }
}

export async function handleDeleteCancel(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply(msg.deleteCancelled);
}
