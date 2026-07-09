// src/lib/telegram/handlers/exportBusiness.ts
import type { Context } from 'telegraf';
import { msg } from '../messages.ru';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { hasBusinessFeatures } from '@/src/lib/billing/tariffs';
import { buildCsvForRun } from '@/src/lib/reports/exportCsv';
import { buildXlsxForRun } from '@/src/lib/reports/exportXlsx';
import { build1cForRun } from '@/src/lib/reports/export1c';

async function sendDocument(telegramId: bigint, buffer: Buffer, filename: string, contentType: string, caption?: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const formData = new FormData();
  formData.append('chat_id', String(telegramId));
  formData.append('document', new Blob([buffer], { type: contentType }), filename);
  if (caption) formData.append('caption', caption);
  await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: formData });
}

async function sendMessage(telegramId: bigint, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: String(telegramId), text }),
  });
}

export async function handleExportCsv(ctx: Context, runId: string): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || !hasBusinessFeatures(user.tariff)) {
    await ctx.reply(msg.exportBusinessOnly);
    return;
  }

  const run = await findRunById(runId);
  if (!run || run.user_id !== user.id || run.status !== 'COMPLETED') {
    await ctx.reply(msg.csvNotReady);
    return;
  }

  try {
    const buffer = await buildCsvForRun(runId);
    await sendDocument(user.telegram_id!, buffer, `Sverka_${runId.slice(0, 8)}.csv`, 'text/csv', msg.csvCaption);
  } catch (err) {
    console.error('[exportCsv] error:', err);
    await sendMessage(user.telegram_id!, msg.exportError);
  }
}

export async function handleExportXlsx(ctx: Context, runId: string): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || !hasBusinessFeatures(user.tariff)) {
    await ctx.reply(msg.exportBusinessOnly);
    return;
  }

  const run = await findRunById(runId);
  if (!run || run.user_id !== user.id || run.status !== 'COMPLETED') {
    await ctx.reply(msg.csvNotReady);
    return;
  }

  try {
    const buffer = await buildXlsxForRun(runId);
    await sendDocument(user.telegram_id!, buffer, `Sverka_${runId.slice(0, 8)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', msg.xlsxCaption);
  } catch (err) {
    console.error('[exportXlsx] error:', err);
    await sendMessage(user.telegram_id!, msg.exportError);
  }
}

export async function handleExport1c(ctx: Context, runId: string): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || !hasBusinessFeatures(user.tariff)) {
    await ctx.reply(msg.exportBusinessOnly);
    return;
  }

  const run = await findRunById(runId);
  if (!run || run.user_id !== user.id || run.status !== 'COMPLETED') {
    await ctx.reply(msg.csvNotReady);
    return;
  }

  try {
    const buffer = await build1cForRun(runId);
    await sendDocument(user.telegram_id!, buffer, `Sverka_1C_${runId.slice(0, 8)}.csv`, 'text/csv', msg.export1cCaption);
  } catch (err) {
    console.error('[export1c] error:', err);
    await sendMessage(user.telegram_id!, msg.exportError);
  }
}

/** Команда /export <run_id> — если пользователь вводит вручную */
export async function handleExportCommand(ctx: Context): Promise<void> {
  const text = (ctx as any).message?.text ?? '';
  const runId = text.trim().split(/\s+/)[1];
  if (!runId) {
    await ctx.reply(msg.exportMissingId);
    return;
  }
  // Показываем выбор формата
  await ctx.reply(msg.exportChooseFormat, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📊 CSV', callback_data: `export_csv:${runId}` },
          { text: '📗 Excel', callback_data: `export_xlsx:${runId}` },
          { text: '📁 Для 1С', callback_data: `export_1c:${runId}` },
        ],
      ],
    },
  });
}
