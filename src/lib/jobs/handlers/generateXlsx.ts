// src/lib/jobs/handlers/generateXlsx.ts
import type { Job } from '@/src/db/repositories/jobs';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findUserById } from '@/src/db/repositories/users';
import { buildXlsxForRun } from '@/src/lib/reports/xlsxExport';
import { msg } from '@/src/lib/telegram/messages.ru';

async function sendDocument(telegramId: bigint, buffer: Buffer, filename: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const formData = new FormData();
  formData.append('chat_id', String(telegramId));
  formData.append('document', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: formData });
}

export async function handleGenerateXlsx(job: Job): Promise<void> {
  const runId = (job.payload as Record<string, string>)?.run_id ?? job.entity_id;
  if (!runId) throw new Error('Missing run_id in generate_xlsx payload');

  const run = await findRunById(runId);
  if (!run || run.status !== 'COMPLETED') return;

  const user = await findUserById(run.user_id);
  if (!user?.telegram_id) return;

  try {
    const buffer = await buildXlsxForRun(run);
    await sendDocument(user.telegram_id, buffer, `Sverka_${runId.slice(0, 8)}.xlsx`);
  } catch (err) {
    console.error('[generateXlsx] error:', err);
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(user.telegram_id), text: msg.xlsxError }),
    });
    throw err; // ретраи
  }
}
