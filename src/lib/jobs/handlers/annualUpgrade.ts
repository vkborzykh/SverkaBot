import type { Job } from '@/src/db/repositories/jobs';
import { findActiveUsersWithTelegramId } from '@/src/db/repositories/users';
import { msg } from '@/src/lib/telegram/messages.ru';
import { TARIFF_PRICES_KOPEKS } from '@/src/lib/billing/tariffs';

const MIN_DAYS_ON_MONTHLY = 60; // предлагать годовую подписку после 2+ месяцев

async function sendTelegramMessage(telegramId: bigint, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(telegramId), text }),
    });
  } catch (err) {
    console.error('[annualUpgrade] sendTelegramMessage error:', err);
  }
}

export async function handleAnnualUpgradeSuggestion(_job: Job): Promise<void> {
  const now = new Date();
  const threshold = new Date(now.getTime() - MIN_DAYS_ON_MONTHLY * 24 * 60 * 60 * 1000);

  const activeUsers = await findActiveUsersWithTelegramId();

  for (const user of activeUsers) {
    if (!user.telegram_id) continue;

    // Только пользователи на помесячных тарифах START или PRO
    if (user.tariff !== 'START' && user.tariff !== 'PRO') continue;
    if (user.subscription_status !== 'ACTIVE') continue;

    // Подписка должна быть активна дольше MIN_DAYS_ON_MONTHLY
    if (!user.subscription_end_date || new Date(user.subscription_end_date) <= threshold) continue;

    const monthPrice = TARIFF_PRICES_KOPEKS[user.tariff as 'START' | 'PRO'];
    const annualPrice = Math.round(monthPrice * 12 * 0.8);
    const economy = monthPrice * 12 - annualPrice;

    const message = msg.annualUpgradeSuggestion(
      user.tariff,
      monthPrice,
      annualPrice,
      economy,
    );

    await sendTelegramMessage(user.telegram_id, message);
  }
}
