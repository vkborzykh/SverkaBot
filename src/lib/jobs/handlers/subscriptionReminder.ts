import type { Job } from '@/src/db/repositories/jobs';
import {
  findUsersExpiringWithinDays,
  findExpiredTrialUsers,
  updateUser,
} from '@/src/db/repositories/users';
import { msg } from '@/src/lib/telegram/messages.ru';

async function sendTelegramMessage(telegramId: bigint, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: String(telegramId), text }),
  }).catch(() => {});
}

export async function handleSubscriptionReminder(_job: Job): Promise<void> {
  // 1. Expire trial users whose trial has ended
  const expiredTrialUsers = await findExpiredTrialUsers();
  for (const user of expiredTrialUsers) {
    await updateUser(user.id, { subscription_status: 'EXPIRED' });
    if (user.telegram_id) {
      await sendTelegramMessage(user.telegram_id, msg.accessExpired);
    }
  }

  // 2. Send reminders to users expiring within 3 days
  const expiringUsers = await findUsersExpiringWithinDays(3);
  for (const user of expiringUsers) {
    if (user.telegram_id) {
      await sendTelegramMessage(user.telegram_id, msg.subscribeReminderExpiry);
    }
  }
}
