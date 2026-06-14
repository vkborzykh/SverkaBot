import type { Job } from '@/src/db/repositories/jobs';
import { findActiveUsersWithTelegramId } from '@/src/db/repositories/users';
import { findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';
import { msg } from '@/src/lib/telegram/messages.ru';

const INACTIVITY_THRESHOLD_DAYS = 30;

async function sendTelegramMessage(telegramId: bigint, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: String(telegramId), text }),
  }).catch(() => {});
}

export async function handleInactivityReminder(_job: Job): Promise<void> {
  const now = new Date();
  const threshold = new Date(now.getTime() - INACTIVITY_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

  const activeUsers = await findActiveUsersWithTelegramId();

  for (const user of activeUsers) {
    if (!user.telegram_id) continue;

    const runs = await findRunsByUserId(user.id, 1);
    const lastRun = runs[0];

    if (!lastRun || lastRun.created_at < threshold) {
      await sendTelegramMessage(user.telegram_id, msg.subscribeReminderInactivity);
    }
  }
}
