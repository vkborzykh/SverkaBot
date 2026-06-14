import type { Job } from '@/src/db/repositories/jobs';
import { findRunById, updateRun } from '@/src/db/repositories/reconciliation-runs';
import { findMatchesByRunId } from '@/src/db/repositories/reconciliation-matches';
import { findMatchItemsByMatchId } from '@/src/db/repositories/reconciliation-match-items';
import { findTransactionsByImportId } from '@/src/db/repositories/canonical-transactions';
import { findUserById } from '@/src/db/repositories/users';
import { findImportById } from '@/src/db/repositories/imports';
import { generateCandidates, updateCandidateScores } from '@/src/lib/reconciliation/candidates';
import { globalMatch } from '@/src/lib/reconciliation/assignment';
import { detectSplitCombined } from '@/src/lib/reconciliation/splitCombined';
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

    // 1. Generate candidates
    await generateCandidates(runId);

    // 2. Score candidates
    await updateCandidateScores(runId);

    // 3. Global 1:1 matching
    await globalMatch(runId);

    // 4. Split / combined detection
    await detectSplitCombined(runId);

    // 5. Recompute final metrics from persisted matches
    const totalWbRows = run.total_wb_rows ?? 0;
    const matches = await findMatchesByRunId(runId);

    let matchedCount = 0;
    let splitCount = 0;
    let combinedCount = 0;
    let ambiguousCount = 0;

    const matchedWbTxIds = new Set<string>();
    const ambiguousWbTxIds = new Set<string>();

    for (const m of matches) {
      const items = await findMatchItemsByMatchId(m.id);
      const wbItems = items.filter((i) => i.side === 'WB');

      if (m.match_type === 'MATCHED') {
        matchedCount++;
        for (const i of wbItems) matchedWbTxIds.add(i.transaction_id);
      } else if (m.match_type === 'SPLIT_MATCHED') {
        splitCount++;
        matchedCount++;
        for (const i of wbItems) matchedWbTxIds.add(i.transaction_id);
      } else if (m.match_type === 'COMBINED_MATCHED') {
        combinedCount++;
        matchedCount++;
        for (const i of wbItems) matchedWbTxIds.add(i.transaction_id);
      } else if (m.match_type === 'AMBIGUOUS') {
        ambiguousCount++;
        for (const i of wbItems) ambiguousWbTxIds.add(i.transaction_id);
      }
    }

    const wbTxs = await findTransactionsByImportId(run.wb_import_id);
    const unmatchedWbTxs = wbTxs.filter(
      (tx) => !matchedWbTxIds.has(tx.id) && !ambiguousWbTxIds.has(tx.id),
    );
    const ambiguousWbTxs = wbTxs.filter((tx) => ambiguousWbTxIds.has(tx.id));

    const unmatchedAmount = unmatchedWbTxs.reduce(
      (s, tx) => s + (tx.amount_kopeks ?? BigInt(0)),
      BigInt(0),
    );
    const ambiguousAmount = ambiguousWbTxs.reduce(
      (s, tx) => s + (tx.amount_kopeks ?? BigInt(0)),
      BigInt(0),
    );

    const unmatchedCount = unmatchedWbTxs.length;
    const matchRate =
      totalWbRows > 0
        ? parseFloat(((matchedCount / totalWbRows) * 100).toFixed(2))
        : 0;

    await updateRun(runId, {
      status: 'COMPLETED',
      completed_at: new Date(),
      matched_count: matchedCount,
      unmatched_count: unmatchedCount,
      ambiguous_count: ambiguousCount,
      split_count: splitCount,
      combined_count: combinedCount,
      match_rate: String(matchRate.toFixed(2)),
      unmatched_amount: unmatchedAmount,
      ambiguous_amount: ambiguousAmount,
    });

    // 6. Enqueue report export
    await enqueue('report_export', runId, { run_id: runId });

    // 7. Notify user
    if (user?.telegram_id) {
      const unmatchedRub = (Number(unmatchedAmount) / 100).toFixed(2);
      await notifyUser(
        user.telegram_id,
        `✅ Сверка завершена. Совпадений: ${matchedCount}. Не найдено: ${unmatchedCount}. Неоднозначно: ${ambiguousCount}. Оценка возможных потерь: ${unmatchedRub} ₽.`,
      );

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
