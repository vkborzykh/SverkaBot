import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findPrimaryReportByRunId } from '@/src/db/repositories/reports';
import { loadFile } from '@/src/lib/ingestion/storage';
import { enqueue } from '@/src/lib/jobs/queue';
import { clearSession } from '@/src/lib/telegram/session';
import { msg } from '@/src/lib/telegram/messages.ru';
import { getReconciliationFinishedKeyboard } from '@/src/lib/telegram/keyboard';
import type { Context as BotContext } from 'telegraf';

async function sendDocumentToUser(
  telegramId: bigint,
  fileBuffer: Buffer,
  filename: string,
  caption: string,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const blob = new Blob([fileBuffer], { type: 'text/html' });
    const formData = new globalThis.FormData();
    formData.append('chat_id', String(telegramId));
    formData.append('document', blob, filename);
    formData.append('caption', caption);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: formData,
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendMessageToUser(telegramId: bigint, text: string, keyboard?: any): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const body: any = {
      chat_id: String(telegramId),
      text,
    };
    if (keyboard) {
      body.reply_markup = keyboard.reply_markup;
    }
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[getReport] sendMessageToUser error:', err);
  }
}

export async function handleGetReport(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const runId = text.trim().split(/\s+/)[1] ?? null;
  if (!runId) {
    await ctx.reply(msg.syncStatusMissingIdShort);
    return;
  }

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) {
    await ctx.reply(msg.accessExpired);
    return;
  }

  const run = await findRunById(runId);
  if (!run || run.user_id !== user.id) {
    await ctx.reply(msg.getReportNotFound);
    return;
  }

  const report = await findPrimaryReportByRunId(runId);

  if (!report || !report.storage_path) {
    if (run.status === 'COMPLETED') {
      await enqueue('report_export', runId, { run_id: runId });
      await ctx.reply(msg.getReportGenerating);
    } else {
      await ctx.reply(msg.getReportNotReady);
    }
    return;
  }

  // Google Sheets экспорт
  if (report.export_type === 'GOOGLE_SHEETS') {
    await ctx.reply(msg.reportReady(report.storage_path));
    return;
  }

  // HTML экспорт
  if (!user.telegram_id) {
    await ctx.reply(msg.getReportError);
    return;
  }
  try {
    const buffer = await loadFile(report.storage_path);
    const sent = await sendDocumentToUser(
      user.telegram_id,
      buffer,
      `report_${runId.slice(0, 8)}.html`,
      msg.reportCaption,
    );
    if (!sent) {
      await ctx.reply(msg.getReportError);
    } else {
      // После успешной отправки очищаем сессию и выводим завершающее сообщение
      if (user.telegram_id) {
        await clearSession(user.telegram_id);
        await sendMessageToUser(user.telegram_id, msg.reconciliationCompleted, getReconciliationFinishedKeyboard(runId));
      }
    }
  } catch (err) {
    console.error('[getReport] failed to load/send report:', err);
    await ctx.reply(msg.getReportError);
  }
}
