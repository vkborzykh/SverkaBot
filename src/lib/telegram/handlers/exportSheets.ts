// /export_sheets <run_id> и кнопка «📈 Google Sheets».
// Доступ: PRO и BUSINESS (hasProFeatures) + ownership.

import type { Context } from 'telegraf';
import { msg } from '../messages.ru';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findReportByRunIdAndType } from '@/src/db/repositories/reports';
import { enqueue } from '@/src/lib/jobs/queue';
import { hasProFeatures } from '@/src/lib/billing/tariffs';

export async function sendSheetsForRun(ctx: Context, runId: string): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;

  if (!hasProFeatures(user.tariff)) {
    await ctx.reply(msg.sheetsProOnly, {
      reply_markup: {
        inline_keyboard: [[{ text: msg.upgradeToProButton, callback_data: 'tariff_pro' }]],
      },
    });
    return;
  }

  const run = await findRunById(runId);
  if (!run || run.user_id !== user.id) {
    await ctx.reply(msg.csvRunNotFound); // та же формулировка «не найдена/не ваша»
    return;
  }
  if (run.status !== 'COMPLETED') {
    await ctx.reply(msg.csvNotReady);
    return;
  }

  // Таблица уже есть — сразу ссылка, без новой джобы
  const existing = await findReportByRunIdAndType(runId, 'GOOGLE_SHEETS');
  if (existing?.storage_path) {
    await ctx.reply(msg.sheetsReady(existing.storage_path), {
      link_preview_options: { is_disabled: true },
    });
    return;
  }

  await enqueue('generate_google_sheet', runId, { run_id: runId });
  await ctx.reply(msg.sheetsQueued);
}

/** Команда /export_sheets <run_id> */
export async function handleExportSheets(ctx: Context): Promise<void> {
  const text = (ctx as { message?: { text?: string } }).message?.text ?? '';
  const runId = text.trim().split(/\s+/)[1];
  if (!runId) {
    await ctx.reply(msg.sheetsMissingId);
    return;
  }
  await sendSheetsForRun(ctx, runId);
}
