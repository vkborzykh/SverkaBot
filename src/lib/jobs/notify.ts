// User-facing failure notification (Russian). Extracted from runner.ts so both
// the legacy drain and the BullMQ worker reuse it. Must never throw.

import type { Job } from '@/src/db/repositories/jobs';
import { findImportById } from '@/src/db/repositories/imports';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findUserById } from '@/src/db/repositories/users';

export async function notifyFailure(job: Job): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    let telegramId: bigint | null = null;
    let text = 'Не удалось обработать запрос. Попробуйте ещё раз.';

    if (job.job_type === 'parse_wb' || job.job_type === 'parse_bank') {
      const imp = job.entity_id ? await findImportById(job.entity_id) : null;
      const user = imp ? await findUserById(imp.user_id) : null;
      telegramId = user?.telegram_id ?? null;
      text =
        job.job_type === 'parse_wb'
          ? '❌ Не удалось обработать отчёт WB. Проверьте файл и попробуйте снова.'
          : '❌ Не удалось обработать выписку. Попробуйте другой файл или формат.';
    } else if (job.job_type === 'reconcile') {
      const run = job.entity_id ? await findRunById(job.entity_id) : null;
      const user = run ? await findUserById(run.user_id) : null;
      telegramId = user?.telegram_id ?? null;
      text = '❌ Не удалось завершить сверку. Попробуйте запустить её ещё раз.';
    }

    if (!telegramId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(telegramId), text }),
    });
  } catch {
    // a failed notification must never break the caller
  }
}
