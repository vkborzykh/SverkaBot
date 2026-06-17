import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findPrimaryReportByRunId } from '@/src/db/repositories/reports';
import { loadFile } from '@/src/lib/ingestion/storage';
import { enqueue } from '@/src/lib/jobs/queue';
import { msg } from '@/src/lib/telegram/messages.ru';
import type { BotContext } from '@/src/lib/telegram/router';

async function sendDocumentToUser(
  telegramId: bigint,
  fileBuffer: Buffer,
  filename: string,
  caption: string,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const blob = new Blob([fileBuffer], { type: 'application/zip' });
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

export async function handleGetReport(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const text = ctx.message?.text ?? '';
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

  // No report yet: regenerate if the run is finished, otherwise it's not ready.
  if (!report || !report.storage_path) {
    if (run.status === 'COMPLETED') {
      await enqueue('report_export', runId, { run_id: runId });
      await ctx.reply(msg.getReportGenerating);
    } else {
      await ctx.reply(msg.getReportNotReady);
    }
    return;
  }

  // Google Sheets export → storage_path is the URL itself.
  if (report.export_type === 'GOOGLE_SHEETS') {
    await ctx.reply(msg.reportReady(report.storage_path));
    return;
  }

  // ZIP export → re-send the archive as a Telegram document.
  if (!user.telegram_id) {
    await ctx.reply(msg.getReportError);
    return;
  }
  try {
    const buffer = await loadFile(report.storage_path);
    const sent = await sendDocumentToUser(
      user.telegram_id,
      buffer,
      `report_${runId.slice(0, 8)}.zip`,
      msg.getReportCaption,
    );
    if (!sent) await ctx.reply(msg.getReportError);
  } catch (err) {
    console.error('[getReport] failed to load/send report:', err);
    await ctx.reply(msg.getReportError);
  }
}
