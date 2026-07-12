import type { Job } from '@/src/db/repositories/jobs';
import { findRunById, updateRun, findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';
import { findUserById } from '@/src/db/repositories/users';
import { findImportById } from '@/src/db/repositories/imports';
import { reconcileWbPayout, type WbPayoutResult } from '@/src/lib/reconciliation/wbPayout';
import { enqueue } from '@/src/lib/jobs/queue';
import { clearSession } from '@/src/lib/telegram/session';
import { hasProFeatures, hasBusinessFeatures } from '@/src/lib/billing/tariffs';

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
    console.error('[notifyUser] error:', err);
  }
}

function rub(kopeks: bigint): string {
  const neg = kopeks < BigInt(0);
  const abs = neg ? -kopeks : kopeks;
  const whole = abs / BigInt(100);
  const cents = abs % BigInt(100);
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return `${neg ? '−' : ''}${grouped},${cents.toString().padStart(2, '0')} ₽`;
}

function buildUserMessage(r: WbPayoutResult): string {
  const e = rub(r.expectedNetKopeks);
  const got = rub(r.receivedKopeks);
  let message = `✅ Сверка завершена. Ожидалось к выплате: ${e}. Поступило от Wildberries: ${got}.`;
  switch (r.status) {
    case 'reconciled':
      message += '\nРасхождений не найдено.';
      break;
    case 'overpaid':
      message += '\nПоступило больше ожидаемого.';
      break;
    case 'underpaid':
      message += `\nВозможная недоплата: ${rub(r.discrepancyKopeks)}.`;
      message += '\n💡 Возможная причина: удержания за логистику, хранение или возвраты.';
      break;
    case 'missing':
      message += '\nПоступлений от Wildberries не найдено.';
      message += '\n💡 Возможная причина: выплата задержана или поступит позже.';
      break;
  }
  return message;
}

type UserRow = NonNullable<Awaited<ReturnType<typeof findUserById>>>;

function hasReportAccess(user: UserRow, now: Date): boolean {
  const isTrialActive =
    user.subscription_status === 'TRIAL' &&
    user.trial_expires_at != null &&
    new Date(user.trial_expires_at) > now;
  const isSubActive =
    user.subscription_status === 'ACTIVE' &&
    user.subscription_end_date != null &&
    new Date(user.subscription_end_date) > now;
  return Boolean(isTrialActive || isSubActive);
}

/** Вычисляет количество последовательных завершённых сверок пользователя без расхождений. */
async function getStreak(userId: string): Promise<number> {
  const runs = await findRunsByUserId(userId, 20);
  let streak = 0;
  for (const run of runs) {
    if (run.status === 'COMPLETED' && (run.loss_kopeks ?? BigInt(0)) === BigInt(0)) {
      streak++;
    } else if (run.status === 'COMPLETED') {
      break; // серия прервана расхождением
    }
    // не COMPLETED пропускаем (может быть FAILED и т.д.), но серию не прерываем
  }
  return streak;
}

export async function handleReconcile(job: Job): Promise<void> {
  const runId = (job.payload as Record<string, string>)?.run_id ?? job.entity_id;
  if (!runId) throw new Error('Missing run_id in job payload');
  const run = await findRunById(runId);
  if (!run) throw new Error(`Reconciliation run not found: ${runId}`);
  if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED') return;
  const user = await findUserById(run.user_id);
  try {
    await updateRun(runId, { status: 'RUNNING', started_at: run.started_at ?? new Date() });

    // Шаг 1/3: анализ WB отчёта
    if (user?.telegram_id) {
      await notifyUser(user.telegram_id, '🔍 Анализирую WB-отчёт (шаг 1/3)');
    }

    // Шаг 2/3: сопоставление с банковской выпиской
    if (user?.telegram_id) {
      await notifyUser(user.telegram_id, '🏦 Сопоставляю с банковской выпиской (шаг 2/3)');
    }

    const result = await reconcileWbPayout(run);

    const turnoverKopeks = result.expectedNetKopeks;
    const diff = result.expectedNetKopeks - result.receivedKopeks;
    const lossKopeks = diff > BigInt(0) ? diff : BigInt(0);
    const lossPercent =
      lossKopeks > BigInt(0) && turnoverKopeks > BigInt(0)
        ? ((Number(lossKopeks) / Number(turnoverKopeks)) * 100).toFixed(4)
        : null;
    await updateRun(runId, {
      status: 'COMPLETED',
      completed_at: new Date(),
      matched_count: result.matchedCount,
      unmatched_count: result.unmatchedCount,
      ambiguous_count: result.ambiguousCount,
      split_count: result.splitCount,
      combined_count: result.combinedCount,
      match_rate: result.matchRate.toFixed(2),
      unmatched_amount: result.unmatchedAmountKopeks,
      ambiguous_amount: result.ambiguousAmountKopeks,
      turnover_kopeks: turnoverKopeks,
      loss_kopeks: lossKopeks,
      loss_percent: lossPercent,
    });

    if (user?.telegram_id) {
      const now = new Date();
      if (hasReportAccess(user, now)) {
        // Приоритет для BUSINESS
        const priority = hasBusinessFeatures(user.tariff) ? 10 : 100;
        await enqueue('report_export', runId, {
          run_id: runId,
          google_sheets: hasProFeatures(user.tariff),
          csv_export: hasBusinessFeatures(user.tariff),
        }, undefined, priority);

        // Шаг 3/3: формирование отчёта
        await notifyUser(
          user.telegram_id,
          '📄 Формирую отчёт (шаг 3/3)',
        );

        await notifyUser(
          user.telegram_id,
          buildUserMessage(result) + '\n\n📄 Готовлю отчёт – он придёт в течение минуты.',
        );

        // Стрик без расхождений
        const streak = await getStreak(user.id);
        if (streak > 0 && result.status === 'reconciled') {
          await notifyUser(
            user.telegram_id,
            `✅ Уже ${streak} ${streak === 1 ? 'сверка' : 'сверки'} подряд без невыясненных сумм!`,
          );
        }

        // Контекстный апселл для тарифа START при обнаружении недоплаты
        if (
          user.tariff === 'START' &&
          result.status === 'underpaid' &&
          result.discrepancyKopeks > BigInt(0)
        ) {
          await notifyUser(
            user.telegram_id,
            `💡 В этой сверке – ${rub(result.discrepancyKopeks)} невыясненных сумм. Хотите отслеживать тренд по всем проверкам? Оформите Профи – и получите статистику и безлимитные сверки: /subscribe`,
          );
        }
      }
      await clearSession(user.telegram_id);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await updateRun(runId, { status: 'FAILED', failure_reason: reason, completed_at: new Date() });
    if (user?.telegram_id) {
      await notifyUser(user.telegram_id, `❌ Сверка завершилась с ошибкой. Попробуйте позже.`);
    }
    throw err;
  }
}
