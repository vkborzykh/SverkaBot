import type { Context } from 'telegraf';
import { msg } from '../messages.ru';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { enqueue } from '@/src/lib/jobs/queue';
import { hasProFeatures } from '@/src/lib/billing/tariffs';
import { buildXlsxForRun } from '@/src/lib/reports/xlsxExport';

export async function sendXlsxForRun(ctx: Context, runId: string): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;

  if (!hasProFeatures(user.tariff)) {
    await ctx.reply(msg.xlsxProOnly, {
      reply_markup: {
        inline_keyboard: [[{ text: msg.upgradeToProButton, callback_data: 'tariff_pro' }]],
      },
    });
    return;
  }

  const run = await findRunById(runId);
  if (!run || run.user_id !== user.id) {
    await ctx.reply(msg.csvRunNotFound);
    return;
  }
  if (run.status !== 'COMPLETED') {
    await ctx.reply(msg.csvNotReady);
    return;
  }

  // Генерируем XLSX и сразу отправляем пользователю
  try {
    const buffer = await buildXlsxForRun(run);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const formData = new FormData();
    formData.append('chat_id', String(user.telegram_id));
    formData.append('document', blob, `Sverka_${runId.slice(0, 8)}.xlsx`);
    formData.append('caption', msg.xlsxCaption);
    await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: formData });
    await ctx.reply(msg.xlsxSent);
  } catch (err) {
    console.error('[exportXlsx] error:', err);
    await ctx.reply(msg.xlsxError);
  }
}

/** Команда /export_xlsx <run_id> */
export async function handleExportXlsx(ctx: Context): Promise<void> {
  const text = (ctx as { message?: { text?: string } }).message?.text ?? '';
  const runId = text.trim().split(/\s+/)[1];
  if (!runId) {
    await ctx.reply(msg.xlsxMissingId);
    return;
  }
  await sendXlsxForRun(ctx, runId);
}
