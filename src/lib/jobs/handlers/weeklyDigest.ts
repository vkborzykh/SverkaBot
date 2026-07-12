import type { Job } from '@/src/db/repositories/jobs';
import { findActiveUsersWithTelegramId } from '@/src/db/repositories/users';
import { enqueue } from '../queue';

async function notifyUser(telegramId: bigint, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(telegramId), text }),
    });
  } catch (err) {
    console.error('[weeklyDigest] notifyUser error:', err);
  }
}

export async function handleWeeklyDigest(job: Job): Promise<void> {
  const users = await findActiveUsersWithTelegramId();
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 – вс, 1 – пн, ..., 5 – пт

  // Отправляем дайджест только в пятницу
  if (dayOfWeek !== 5) return;

  const message = '📅 Сегодня Wildberries формирует еженедельный отчёт. Не забудьте загрузить его для сверки!';

  for (const user of users) {
    if (!user.telegram_id) continue;
    try {
      await notifyUser(user.telegram_id, message);
    } catch (err) {
      console.error(`[weeklyDigest] failed for user ${user.id}:`, err);
    }
  }
}
