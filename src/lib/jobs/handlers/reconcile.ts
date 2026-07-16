import type { Job } from '@/src/db/repositories/jobs';
import { findRunById, updateRun, findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';
import { findUserById, updateUser } from '@/src/db/repositories/users';
import { findImportById } from '@/src/db/repositories/imports';
import { reconcileWbPayout, type WbPayoutResult } from '@/src/lib/reconciliation/wbPayout';
import { enqueue } from '@/src/lib/jobs/queue';
import { clearSession } from '@/src/lib/telegram/session';
import { hasProFeatures, hasBusinessFeatures, monthlyLimitFor } from '@/src/lib/billing/tariffs';
import { getDb } from '@/src/db';
import { reconciliation_runs, canonical_transactions } from '@/src/db/schema';
import { eq, and, gte, lte, sql } from 'drizzle-orm';

// Построчный движок (shadow-прогон)
import { generateCandidates } from '@/src/lib/reconciliation/candidates';
import { updateCandidateScores } from '@/src/lib/reconciliation/candidates';
import { globalMatch } from '@/src/lib/reconciliation/assignment';
import { detectSplitCombined } from '@/src/lib/reconciliation/splitCombined';
import { createAdminNotification } from '@/src/db/repositories/admin-notifications';

const MINIAPP_URL = process.env.MINIAPP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}/miniapp/stats.html` : '');

async function notifyUser(telegramId: bigint, text: string, replyMarkup?: any): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const body: any = { chat_id: String(telegramId), text };
    if (replyMarkup) {
      body.reply_markup = replyMarkup;
    }
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

// Локализованные названия категорий
const CATEGORY_LABELS: Record<string, string> = {
  LOGISTICS: 'логистика',
  STORAGE: 'хранение',
  PENALTY: 'штрафы',
  REFUND: 'возвраты',
  COMMISSION: 'комиссия',
  MARKETING: 'реклама',
  DEDUCTION: 'прочие удержания',
  OTHER: 'прочие',
};

async function getWbDeductionsByCategory(wbImportId: string): Promise<Record<string, bigint>> {
  const db = getDb();
  const rows = await db
    .select({
      category: canonical_transactions.category,
      total: sql<bigint>`COALESCE(SUM(${canonical_transactions.amount_kopeks}), 0)`.mapWith((v: string) => BigInt(v)),
    })
    .from(canonical_transactions)
    .where(
      and(
        eq(canonical_transactions.import_id, wbImportId),
        eq(canonical_transactions.direction, 'OUT'),
      ),
    )
    .groupBy(canonical_transactions.category);

  const map: Record<string, bigint> = {};
  for (const row of rows) {
    const cat = row.category || 'OTHER';
    map[cat] = (map[cat] || BigInt(0)) + row.total;
  }
  return map;
}

function buildDeductionText(deductions: Record<string, bigint>): string {
  const parts = Object.entries(deductions)
    .filter(([, amount]) => amount > BigInt(0))
    .sort(([, a], [, b]) => (b > a ? 1 : -1))
    .map(([cat, amount]) => `${CATEGORY_LABELS[cat] || cat}: ${rub(amount)}`);

  if (parts.length === 0) return '';
  return 'Из них:\n' + parts.map((p) => `• ${p}`).join('\n');
}

async function buildUserMessage(r: WbPayoutResult, wbImportId: string): Promise<string> {
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
    case 'underpaid': {
      message += `\nВозможная недоплата: ${rub(r.discrepancyKopeks)}.`;
      const deductions = await getWbDeductionsByCategory(wbImportId);
      const deductionText = buildDeductionText(deductions);
      if (deductionText) {
        message += '\n' + deductionText;
      } else {
        message += '\n💡 Возможная причина: удержания за логистику, хранение или возвраты.';
      }
      break;
    }
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

/**
 * Shadow-прогон построчного движка сверки.
 * Запускается параллельно с агрегатной моделью; результат пишется в лог и admin_notifications.
 * Никак не влияет на ответ пользователю.
 */
async function runRowLevelShadow(
  runId: string,
  run: NonNullable<Awaited<ReturnType<typeof findRunById>>>,
  aggregateResult: WbPayoutResult,
): Promise<void> {
  const start = Date.now();
  try {
    // 1. Генерация кандидатов
    const candidateCount = await generateCandidates(runId);
    // 2. Скоринг
    await updateCandidateScores(runId);
    // 3. Глобальное сопоставление (dryRun, без записи в БД)
    const stats = await globalMatch(runId, { dryRun: true });
    // 4. Обнаружение split/combined
    try {
      await detectSplitCombined(runId);
    } catch {
      // в dry-run может не быть нужных матчей
    }

    const duration = Date.now() - start;
    const agg = {
      status: aggregateResult.status,
      lossKopeks: String(aggregateResult.discrepancyKopeks),
      matchRate: aggregateResult.matchRate,
    };
    const row = {
      matchedCount: stats.matchedCount,
      unmatchedCount: stats.unmatchedCount,
      ambiguousCount: stats.ambiguousCount,
      matchRate: stats.matchRate,
      unmatchedAmount: String(stats.unmatchedAmount),
      ambiguousAmount: String(stats.ambiguousAmount),
    };

    console.log(
      `[shadow-recon] run=${runId} duration=${duration}ms agg=${JSON.stringify(agg)} row=${JSON.stringify(row)}`,
    );

    await createAdminNotification({
      severity: 'INFO',
      title: `Shadow reconciliation ${runId.slice(0, 8)}`,
      message: `Duration: ${duration}ms\nAggregate: ${JSON.stringify(agg)}\nRow-level: ${JSON.stringify(row)}`,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[shadow-recon] run=${runId} error: ${reason}`);
    await createAdminNotification({
      severity: 'WARN',
      title: `Shadow reconciliation FAILED ${runId.slice(0, 8)}`,
      message: reason,
    });
  }
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

    // Shadow-прогон построчного движка (не влияет на пользователя)
    runRowLevelShadow(runId, run, result).catch((err) =>
      console.error('[shadow-recon] unhandled rejection:', err),
    );

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

        const userMessage = await buildUserMessage(result, run.wb_import_id);
        await notifyUser(
          user.telegram_id,
          userMessage + '\n\n📄 Готовлю отчёт – он придёт в течение минуты.',
        );

        const streak = await getStreak(user.id);
        const streakMsg = streak > 1 && result.status === 'reconciled'
          ? `✅ Уже ${pluralizeSverka(streak)} подряд без невыясненных сумм!`
          : null;

        const anomalyMsg = await checkAnomaly(user.id, lossKopeks);

        const webAppButton = MINIAPP_URL
          ? [{ text: '📈 Открыть статистику', web_app: { url: MINIAPP_URL } }]
          : null;

        // Отправляем сообщение о стрике с кнопкой мини-аппа, если есть стрик
        if (streakMsg) {
          const markup = webAppButton ? { inline_keyboard: [webAppButton] } : undefined;
          await notifyUser(user.telegram_id, streakMsg, markup);
        }

        // Отправляем сообщение об аномалии с кнопкой мини-аппа
        if (anomalyMsg) {
          const markup = webAppButton ? { inline_keyboard: [webAppButton] } : undefined;
          await notifyUser(user.telegram_id, anomalyMsg, markup);
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
