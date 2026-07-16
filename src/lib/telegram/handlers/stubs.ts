import type { Context } from 'telegraf';
import { msg } from '../messages.ru';

export async function handleRunSync(ctx: Context): Promise<void> {
  await ctx.reply(msg.syncNeedBothFiles);
}

export async function handleHistory(ctx: Context): Promise<void> {
  await ctx.reply(msg.historyHeader);
}

export async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(msg.helpText, { parse_mode: 'HTML' });
}

export async function handleGetReport(ctx: Context): Promise<void> {
  await ctx.reply(msg.historyHeader);
}

export async function handleStatus(ctx: Context): Promise<void> {
  await ctx.reply(msg.importStatusMissingId);
}

export async function handleSyncStatus(ctx: Context): Promise<void> {
  await ctx.reply(msg.syncStatusMissingIdShort);
}
