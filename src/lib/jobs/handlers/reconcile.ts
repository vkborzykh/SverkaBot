import type { Job } from '@/src/db/repositories/jobs';
import { findRunById, updateRun } from '@/src/db/repositories/reconciliation-runs';
import { findUserById } from '@/src/db/repositories/users';
import { findImportById } from '@/src/db/repositories/imports';
import { reconcileWbPayout, type WbPayoutResult } from '@/src/lib/reconciliation/wbPayout';
import { enqueue } from '@/src/lib/jobs/queue';

async function notifyUser(telegramId: bigint, text: string): Promise<void> {
  console.log(`[notifyUser] Attempting to send to ${telegramId}: ${text.slice(0, 50)}...`);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[notifyUser] TELEGRAM_BOT_TOKEN is missing');
    return;
  }
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = { chat_id: String(telegramId), text };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const responseText = await res.text();
    console.log(`[notifyUser] Response status: ${res.status}`);
    if (!res.ok) {
      console.error(`[notifyUser] Non-ok response: ${res.status} ${responseText}`);
    }
  } catch (err) {
    console.error('[notifyUser] Error sending message:', err);
  }
}

// kopeks (bigint) → "12 345,67 ₽" with RU formatting
function rub(kopeks: bigint): string {
  const neg = kopeks < BigInt(0);
  const abs = neg ? -kopeks : kopeks;
  const whole = abs / BigInt(100);
  const cents = abs % BigInt(100);
  const grouped = whole
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return `${neg ? '−' : ''}${grouped},${cents.toString().padStart(2, '0')} ₽`;
}

function buildUserMessage(r: WbPayoutResult): string {
  const e = rub(r.expectedNetKopeks);
  const got = rub(r.receivedKopeks);
  switch (r.status) {
    case 'reconciled':
      return `✅ Сверка завершена. Ожидалось к выплате: ${e}. Поступило от Wildberries: ${got}. Расхождений не найдено.`;
    case 'overpaid':
      return `✅ Сверка завершена. Ожидалось: ${e}. Поступило: ${got} (больше ожидаемого — расхождений в вашу пользу).`;
    case 'underpaid':
      return `⚠️ Сверка завершена. Ожидалось: ${e}. Поступило: ${got}. Возможная недоплата: ${rub(r.discrepancyKopeks)}.`;
    case 'missing':
    default:
      // заменено «Возможная потеря» на «Сумма неподтверждённых выплат»
      return `⚠️ Сверка завершена. Ожидалось к выплате: ${e}, но поступлений от Wildberries не найдено. Сумма неподтверждённых выплат: ${rub(r.unmatchedAmountKopeks)}.`;
  }
}

export async function handleReconcile(job: Job): Promise<void> {
  const runId = (job.payload as Record<string, string>)?.run_id ?? job.entity_id;
  console.log(`[handleReconcile] Starting for runId: ${runId}`);
  if (!runId) {
    console.error('[handleReconcile] Missing run_id in job payload');
    throw new Error('Missing run_id in job payload');
  }

  const run = await findRunById(runId);
  if (!run) {
    console.error(`[handleReconcile] Run not found: ${runId}`);
    throw new Error(`Reconciliation run not found: ${runId}`);
  }
  console.log(`[handleReconcile] Found run with status: ${run.status}`);

    if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'CANCELLED') {
    console.log(`[handleReconcile] Run already ${run.status}, skipping.`);
    return;
  }

  const user = await findUserById(run.user_id);
  console.log(`[handleReconcile] User found: ${user?.id}, telegram_id: ${user?.telegram_id}`);
  const bankImport = await findImportById(run.bank_import_id);
  console.log(`[handleReconcile] Bank import quality: ${bankImport?.quality_status}`);

  try {
    console.log(`[handleReconcile] Updating run to RUNNING...`);
    await updateRun(runId, { status: 'RUNNING', started_at: run.started_at ?? new Date() });

    console.log(`[handleReconcile] Calling reconcileWbPayout...`);
    const result = await reconcileWbPayout(run);
    console.log(`[handleReconcile] Reconcile result status: ${result.status}`);

    // Канонические метрики (единый источник истины).
    // turnover = ожидаемый нетто-выплаты, loss = неподтверждённая сумма.
    const turnoverKopeks = result.expectedNetKopeks;
    const diff = result.expectedNetKopeks - result.receivedKopeks;
    const lossKopeks = diff > BigInt(0) ? diff : BigInt(0);
    const lossPercent =
      lossKopeks > BigInt(0) && turnoverKopeks > BigInt(0)
        ? ((Number(lossKopeks) / Number(turnoverKopeks)) * 100).toFixed(4)
        : null;

    console.log(`[handleReconcile] Updating run to COMPLETED...`);
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

    console.log(`[handleReconcile] Enqueueing report export...`);
    await enqueue('report_export', runId, { run_id: runId });

    // ── УВЕДОМЛЕНИЕ ──
    if (user?.telegram_id) {
      console.log(`[handleReconcile] Notifying user ${user.telegram_id}`);
      let message = buildUserMessage(result);

      if (bankImport?.quality_status === 'LOW_CONFIDENCE') {
        message += '\n\n⚠️ Выписка была распознана с низкой уверенностью. Результаты сверки могут быть неточны.';
      }

      message += '\n\n📄 Готовлю отчёт – он придёт в течение минуты.';
      await notifyUser(user.telegram_id, message);
      console.log(`[handleReconcile] Notification sent.`);
    } else {
      console.warn(`[handleReconcile] No telegram_id for user ${run.user_id}, skipping notifications.`);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[handleReconcile] Error during reconciliation: ${reason}`);
    await updateRun(runId, {
      status: 'FAILED',
      failure_reason: reason,
      completed_at: new Date(),
    });
    if (user?.telegram_id) {
      await notifyUser(
        user.telegram_id,
        `❌ Сверка завершилась с ошибкой. Попробуйте позже или обратитесь в поддержку. ID сверки: ${runId}.`,
      );
    }
    throw err;
  }
}
