import type { Job } from '@/src/db/repositories/jobs';
import { findRunById, updateRun } from '@/src/db/repositories/reconciliation-runs';
import { findUserById } from '@/src/db/repositories/users';
import { findImportById } from '@/src/db/repositories/imports';
import { reconcileWbPayout, type WbPayoutResult } from '@/src/lib/reconciliation/wbPayout';
import { enqueue } from '@/src/lib/jobs/queue';

async function notifyUser(telegramId: bigint, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(telegramId), text }),
    });
  } catch {
    // notification failures must not fail the job
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
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0'); // non-breaking space thousands
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
      return `⚠️ Сверка завершена. Ожидалось к выплате: ${e}, но поступлений от Wildberries не найдено. Возможная потеря: ${rub(r.unmatchedAmountKopeks)}.`;
  }
}

export async function handleReconcile(job: Job): Promise<void> {
  const runId = (job.payload as Record<string, string>)?.run_id ?? job.entity_id;
  if (!runId) throw new Error('Missing run_id in job payload');

  const run = await findRunById(runId);
  if (!run) throw new Error(`Reconciliation run not found: ${runId}`);

  // Idempotency
  if (run.status === 'COMPLETED' || run.status === 'FAILED') return;

  const user = await findUserById(run.user_id);
  const bankImport = await findImportById(run.bank_import_id);

  try {
    await updateRun(runId, { status: 'RUNNING', started_at: run.started_at ?? new Date() });

    // Report-level reconciliation: aggregate WB net payout vs bank WB credits.
    // (An empty candidate set is not a failure — see "missing"/UNMATCHED below.)
    const result = await reconcileWbPayout(run);

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
    });

    // Enqueue report export
    await enqueue('report_export', runId, { run_id: runId });

    // Notify user
    if (user?.telegram_id) {
      await notifyUser(user.telegram_id, buildUserMessage(result));

      if (bankImport?.quality_status === 'LOW_CONFIDENCE') {
        await notifyUser(
          user.telegram_id,
          '⚠️ Выписка была распознана с низкой уверенностью. Результаты сверки могут быть неточны.',
        );
      }

      await notifyUser(
        user.telegram_id,
        `Для скачивания отчёта используйте /get_report ${runId}`,
      );
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
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
