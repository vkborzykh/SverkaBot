import type { Context } from 'telegraf';
import { msg } from '../messages.ru';

export async function handleRunSync(ctx: Context): Promise<void> {
  await ctx.reply(msg.syncNeedBothFiles);
}

export async function handleHistory(ctx: Context): Promise<void> {
  await ctx.reply(msg.historyHeader);
}

export async function handleHelp(ctx: Context): Promise<void> {
  await ctx.reply(
    '/upload_wb — загрузить отчёт WB\n' +
      '/upload_bank — загрузить выписку банка\n' +
      '/run_sync — запустить сверку\n' +
      '/history — история сверок\n' +
      '/subscribe — управление подпиской\n' +
      '/loss_calculator — оценить возможные потери\n' +
      '/delete_my_data — удалить мои данные',
  );
}

export async function handleGetReport(ctx: Context): Promise<void> {
  await ctx.reply(msg.historyHeader);
}

export async function handleStatus(ctx: Context): Promise<void> {
  await ctx.reply('Введите ID импорта: /status <id>');
}

export async function handleSyncStatus(ctx: Context): Promise<void> {
  await ctx.reply('Введите ID сверки: /sync_status <id>');
}

export async function handleDeleteMyData(ctx: Context): Promise<void> {
  await ctx.reply(msg.deleteConfirmPrompt);
}
