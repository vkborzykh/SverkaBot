import type { Job } from '@/src/db/repositories/jobs';
import { getDb } from '@/src/db';
import { users, imports } from '@/src/db/schema';
import { and, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import { enqueue } from '../queue';

const RECENT_DAYS = 7;

async function notifyUser(telegramId: bigint, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(telegramId),
        text,
        reply_markup: {
          inline_keyboard: [[
            { text: '📄 Загрузить отчёт', callback_data: 'upload_wb_inline' }
          ]]
        }
      }),
    });
  } catch (err) {
    console.error('[weeklyDigest] notifyUser error:', err);
  }
}

export async function handleWeeklyDigest(job: Job): Promise<void> {
  const db = getDb();

  // Выбираем пользователей с TRIAL и ACTIVE подпиской (не только ACTIVE, как раньше)
  const activeUsers = await db
    .select({
      id: users.id,
      telegram_id: users.telegram_id,
    })
    .from(users)
    .where(
      and(
        isNull(users.deleted_at),
        inArray(users.subscription_status, ['TRIAL', 'ACTIVE'])
      )
    );

  const message = '📅 Отчёт Wildberries за прошлую неделю уже должен быть доступен в личном кабинете. Загрузите его для сверки, чтобы вовремя заметить расхождения.';

  for (const user of activeUsers) {
    if (!user.telegram_id) continue;

    // Проверяем, загружал ли пользователь WB‑отчёт за последние RECENT_DAYS дней
    const recentCutoff = new Date();
    recentCutoff.setDate(recentCutoff.getDate() - RECENT_DAYS);

    const recentImports = await db
      .select({ id: imports.id })
      .from(imports)
      .where(
        and(
          eq(imports.user_id, user.id),
          eq(imports.source_type, 'WB'),
          eq(imports.status, 'COMPLETED'),
          gte(imports.created_at, recentCutoff)
        )
      )
      .limit(1);

    if (recentImports.length > 0) {
      // Уже загрузил недавно – не беспокоим
      continue;
    }

    try {
      await notifyUser(user.telegram_id, message);
    } catch (err) {
      console.error(`[weeklyDigest] failed for user ${user.id}:`, err);
    }
  }
}
