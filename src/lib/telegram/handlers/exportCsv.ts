// /export_csv <run_id> и общая отправка CSV (используется также из истории).
// Доступ: только BUSINESS (hasBusinessFeatures) + ownership-проверка сверки.

import type { Context } from 'telegraf';
import { msg } from '../messages.ru';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findReportByRunIdAndType } from '@/src/db/repositories/reports';
import { loadFile } from '@/src/lib/ingestion/storage';
import { hasBusinessFeatures } from '@/src/lib/billing/tariffs';

async function sendCsvDocument(telegramId: bigint, runId: string, buffer: Buffer): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const blob = new Blob([buffer], { type: 'text/csv' });
  const formData = new FormData();
  formData.append('chat_id', String(telegramId));
  formData.append('document', blob, `sverka_${runId.slice(0, 8)}.csv`);
  formData.append('caption', msg.csvCaption);
  await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: formData,
  });
}

/** Общая точка отправки CSV: тариф → ownership → файл из Storage,
 *  при его отсутствии/истечении — регенерация из канонических данных. */
export async function sendCsvForRun(ctx: Context, runId: string): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;

  if (!hasBusinessFeatures(user.tariff)) {
    await ctx.reply(msg.csvBusinessOnly, {
      reply_markup: {
        inline_keyboard: [[{ text: msg.upgradeToBusinessButton, callback_data: 'tariff_business' }]],
      },
    });
    return;
  }

  const run = await findRunById(runId);
  // Ownership: runId приходит из текста команды или callback_data
  if (!run || run.user_id !== user.id) {
    await ctx.reply(msg.csvRunNotFound);
    return;
  }
  if (run.status !== 'COMPLETED') {
    await ctx.reply(msg.csvNotReady);
    return;
  }

  // 1) Пытаемся отдать сохранённый файл (если не истёк retention)
  let buffer: Buffer | null = null;
  try {
    const report = await findReportByRunIdAndType(runId, 'CSV');
    if (report?.storage_path) {
      const expired = report.retention_days
        ? Date.now() > new Date(report.created_at).getTime() + report.retention_days * 24 * 60 * 60 * 1000
        : false;
      if (!expired) buffer = await loadFile(report.storage_path);
    }
  } catch (err) {
    console.error('[exportCsv] stored file unavailable, will regenerate:', err);
  }

  // 2) Фолбэк: регенерация из canonical_transactions (живут, пока жив импорт)
  if (!buffer) {
    try {
      const { buildCsvForRun } = await import('@/src/lib/reports/csvExport');
      buffer = await buildCsvForRun(run);
    } catch (err) {
      console.error('[exportCsv] regeneration failed:', err);
    }
  }

  if (!buffer) {
    await ctx.reply(msg.csvExpired);
    return;
  }
  if (!user.telegram_id) return;
  try {
    await sendCsvDocument(user.telegram_id, runId, buffer);
  } catch (err) {
    console.error('[exportCsv] sendDocument failed:', err);
    await ctx.reply(msg.getReportError);
  }
}

/** Команда /export_csv <run_id> */
export async function handleExportCsv(ctx: Context): Promise<void> {
  const text = (ctx as { message?: { text?: string } }).message?.text ?? '';
  const runId = text.trim().split(/\s+/)[1];
  if (!runId) {
    await ctx.reply(msg.csvMissingId);
    return;
  }
  await sendCsvForRun(ctx, runId);
}
