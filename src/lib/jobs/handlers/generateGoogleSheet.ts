// Job-handler generate_google_sheet: идемпотентно создаёт таблицу по сверке
// и присылает пользователю ссылку. Ретраи/алерты даёт runner (3×, backoff).

import type { Job } from '@/src/db/repositories/jobs';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findUserById } from '@/src/db/repositories/users';
import { findImportById } from '@/src/db/repositories/imports';
import { findCabinetById } from '@/src/db/repositories/wb-cabinets';
import { findReportByRunIdAndType, createReport } from '@/src/db/repositories/reports';
import { collectWbCsvRows } from '@/src/lib/reports/csvExport';
import { createSpreadsheetForRun } from '@/src/lib/reports/googleSheets';
import { msg } from '@/src/lib/telegram/messages.ru';

async function notifyUser(telegramId: bigint, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(telegramId), text, disable_web_page_preview: true }),
    });
  } catch (err) {
    console.error('[generateGoogleSheet] notify error:', err);
  }
}

function fmtDmy(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

export async function handleGenerateGoogleSheet(job: Job): Promise<void> {
  const runId = (job.payload as Record<string, string>)?.run_id ?? job.entity_id;
  if (!runId) throw new Error('Missing run_id in generate_google_sheet payload');

  // Идемпотентность: при ретрае/дубле джобы вторую таблицу не создаём
  const existing = await findReportByRunIdAndType(runId, 'GOOGLE_SHEETS');
  const run = await findRunById(runId);
  if (!run) throw new Error(`Reconciliation run not found: ${runId}`);
  const user = await findUserById(run.user_id);

  if (existing?.storage_path) {
    if (user?.telegram_id) await notifyUser(user.telegram_id, msg.sheetsReady(existing.storage_path));
    return;
  }
  if (run.status !== 'COMPLETED') return;

  // Кабинет для заголовка (best-effort)
  let cabinetName: string | null = null;
  try {
    const wbImport = await findImportById(run.wb_import_id);
    const cabId = (wbImport as { cabinet_id?: string | null } | undefined)?.cabinet_id;
    if (cabId) cabinetName = (await findCabinetById(cabId))?.name ?? null;
  } catch { /* не критично */ }

  try {
    const rows = await collectWbCsvRows(run);
    const url = await createSpreadsheetForRun(
      {
        runIdShort: runId.slice(0, 8),
        dateStr: fmtDmy(run.created_at),
        cabinetName,
        expectedKopeks: run.turnover_kopeks ?? BigInt(0),
        receivedKopeks: (run.turnover_kopeks ?? BigInt(0)) - (run.loss_kopeks ?? BigInt(0)),
        lossKopeks: run.loss_kopeks ?? BigInt(0),
        matchRate: run.match_rate ? String(run.match_rate) : '—',
      },
      rows,
    );
    await createReport({
      run_id: runId,
      storage_path: url, // реюз поля: для GOOGLE_SHEETS здесь URL, не путь Storage
      export_type: 'GOOGLE_SHEETS',
      report_version: 1,
      is_primary: false,
    });
    if (user?.telegram_id) await notifyUser(user.telegram_id, msg.sheetsReady(url));
  } catch (err) {
    // Бросаем дальше: runner сделает ретраи и admin-alert; пользователя
    // уведомляем только на финальном фейле — это делает notifyFailure/руками:
    if (user?.telegram_id && (job.retries ?? 0) + 1 >= 3) {
      await notifyUser(user.telegram_id, msg.sheetsError);
    }
    throw err;
  }
}
