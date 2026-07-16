import type { Job } from '@/src/db/repositories/jobs';
import { findRunById, updateRun, findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';
import { findUserById, updateUser } from '@/src/db/repositories/users';
import { findImportById } from '@/src/db/repositories/imports';
import { reconcileWbPayout, type WbPayoutResult } from '@/src/lib/reconciliation/wbPayout';
import { enqueue } from '@/src/lib/jobs/queue';
import { clearSession } from '@/src/lib/telegram/session';
import { hasProFeatures, hasBusinessFeatures, monthlyLimitFor } from '@/src/lib/billing/tariffs';
import { getDb } from '@/src/db';
import { reconciliation_runs } from '@/src/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

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

async function getStreak(userId: string): Promise<number> {
  const runs = await findRunsByUserId(userId, 20);
  let streak = 0;
  for (const run of runs) {
    if (run.status === 'COMPLETED' && (run.loss_kopeks ?? BigInt(0)) === BigInt(0)) {
      streak++;
    } else if (run.status === 'COMPLETED') {
      break;
    }
  }
  return streak;
}

/** Склоняет слово «сверка» в зависимости от числа */
function pluralizeSverka(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} сверка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${count} сверки`;
  return `${count} сверок`;
}

/** Проверяет, не является ли текущее расхождение аномально большим по сравнению со средним за последние 3 месяца. */
async function checkAnomaly(userId: string, currentLoss: bigint): Promise<string | null> {
  if (currentLoss <= BigInt(0)) return null;
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const runs = await findRunsByUserId(userId, 100);
  const historical = runs.filter(
    (r) => r.status === 'COMPLETED' && r.completed_at && new Date(r.completed_at) >= threeMonthsAgo && r.loss_kopeks !== null && BigInt(r.loss_kopeks) > BigInt(0)
  );
  if (historical.length === 0) return null;
  const totalLoss = historical.reduce((sum, r) => sum + BigInt(r.loss_kopeks!), BigInt(0));
  const avgLoss = totalLoss / BigInt(historical.length);
  if (currentLoss > avgLoss * BigInt(2)) {
    return `⚠️ Необычно большое расхождение: ${rub(currentLoss)} (среднее за 3 месяца – ${rub(avgLoss)}). Возможна ошибка в отчёте WB.`;
  }
  return null;
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

    if (user?.telegram_id) {
      await notifyUser(user.telegram_id, '🔍 Анализирую WB-отчёт (шаг 1/3)');
    }
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

    // Инкремент счётчика сверок – только при успешном завершении, с дедупликацией
    if (user) {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

      const db = getDb();
      const existingCompleted = await db
        .select({ id: reconciliation_runs.id })
        .from(reconciliation_runs)
        .where(
          and(
            eq(reconciliation_runs.user_id, user.id),
            eq(reconciliation_runs.wb_import_id, run.wb_import_id),
            eq(reconciliation_runs.bank_import_id, run.bank_import_id),
            eq(reconciliation_runs.status, 'COMPLETED'),
            gte(reconciliation_runs.created_at, startOfMonth),
            lte(reconciliation_runs.created_at, endOfMonth)
          )
        )
        .limit(1);

      // Увеличиваем счётчик, только если нет другого успешного run с той же парой импортов в этом месяце
      if (existingCompleted.length === 0) {
        const used = user.monthly_reconciliations ?? 0;
        await updateUser(user.id, { monthly_reconciliations: used + 1 });
      }
    }

    if (user?.telegram_id) {
      const now = new Date();
      if (hasReportAccess(user, now)) {
        const priority = hasBusinessFeatures(user.tariff) ? 10 : 100;
        await enqueue('report_export', runId, {
          run_id: runId,
          google_sheets: hasProFeatures(user.tariff),
          csv_export: hasBusinessFeatures(user.tariff),
        }, undefined, priority);

        await notifyUser(user.telegram_id, '📄 Формирую отчёт (шаг 3/3)');

        await notifyUser(
          user.telegram_id,
          buildUserMessage(result) + '\n\n📄 Готовлю отчёт – он придёт в течение минуты.',
        );

        const streak = await getStreak(user.id);
        if (streak > 1 && result.status === 'reconciled') {
          await notifyUser(
            user.telegram_id,
            `✅ Уже ${pluralizeSverka(streak)} подряд без невыясненных сумм!`,
          );
        }

        const anomalyMsg = await checkAnomaly(user.id, lossKopeks);
        if (anomalyMsg) {
          await notifyUser(user.telegram_id, anomalyMsg);
        }

        // Контекстный апсейл для Старта при недоплате
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

        // Контекстный апсейл для PRO без аддона при недоплате
        if (
          user.tariff === 'PRO' &&
          !user.export_addon_active &&
          result.status === 'underpaid' &&
          result.discrepancyKopeks > BigInt(0)
        ) {
          await notifyUser(
            user.telegram_id,
            `🧩 Обнаружена недоплата – ${rub(result.discrepancyKopeks)}. Хотите выгрузить эту сверку для бухгалтера? Подключите экспорт CSV/XLSX/1С за 590 ₽/мес: /subscribe`,
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
