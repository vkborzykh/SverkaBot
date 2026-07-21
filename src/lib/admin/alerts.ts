import { createAdminNotification } from '@/src/db/repositories/admin-notifications';

export async function alertAdmins(severity: string, title: string, message: string): Promise<void> {
  try {
    await createAdminNotification({ severity, title, message });
  } catch (e) {
    console.error('[alertAdmins] persist failed:', e);
  }
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const ids = (process.env.TELEGRAM_ADMIN_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const text = `❌ ${title}\n\n${message}`;
  await Promise.all(
    ids.map((id) =>
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: id, text }),
      }).catch(() => {}),
    ),
  );
}

export async function alertWorkerFailure(
  job: { job_type: string | null; id: string; entity_id: string | null },
  error: string,
): Promise<void> {
  const jobType = job.job_type ?? 'unknown';
  const trimmed = error.length > 500 ? error.slice(0, 500) + '…' : error;
  await alertAdmins(
    'error',
    `Критическая ошибка в воркере: ${jobType}`,
    `Задача: ${jobType}\nID: ${job.id}\nObject: ${job.entity_id ?? '—'}\nОшибка: ${trimmed}`,
  );
}
