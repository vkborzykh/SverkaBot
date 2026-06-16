import type { Job } from '@/src/db/repositories/jobs';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findMatchesByRunId } from '@/src/db/repositories/reconciliation-matches';
import { findMatchItemsByMatchId } from '@/src/db/repositories/reconciliation-match-items';
import { findEvidenceByMatchId } from '@/src/db/repositories/reconciliation-evidence';
import { findTransactionsByImportId, type CanonicalTransaction } from '@/src/db/repositories/canonical-transactions';
import { findParsingErrorsByImportId } from '@/src/db/repositories/parsing-errors';
import { findUserById } from '@/src/db/repositories/users';
import { findPrimaryReportByRunId, createReport } from '@/src/db/repositories/reports';
import { storeReport } from '@/src/lib/ingestion/storage';
import {
  buildSummaryCSV,
  buildMatchedCSV,
  buildUnmatchedCSV,
  buildAmbiguousCSV,
  buildAllTransactionsCSV,
  buildEvidenceCSV,
  buildParsingErrorsCSV,
  buildMetricsCSV,
  type MatchedRow,
} from '@/src/lib/reports/csvBuilders';
import { createZip } from '@/src/lib/reports/zip';

async function sendDocumentToUser(
  telegramId: bigint,
  fileBuffer: Buffer,
  filename: string,
  caption: string,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    const blob = new Blob([fileBuffer], { type: 'application/zip' });

    const formData = new globalThis.FormData();
    formData.append('chat_id', String(telegramId));
    formData.append('document', blob, filename);
    formData.append('caption', caption);

    await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: formData,
    });
  } catch {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: String(telegramId),
          text: caption,
        }),
      });
    } catch {
      // notification failures must not fail the job
    }
  }
}

function computeLossEstimate(run: {
  unmatched_amount?: bigint | null;
  ambiguous_amount?: bigint | null;
}): bigint {
  const unmatched = run.unmatched_amount ?? BigInt(0);
  const ambiguous = run.ambiguous_amount ?? BigInt(0);
  return unmatched + ambiguous / BigInt(2);
}

export async function handleReportExport(job: Job): Promise<void> {
  const runId = (job.payload as Record<string, string>)?.run_id ?? job.entity_id;
  if (!runId) throw new Error('Missing run_id in report_export job payload');

  // Idempotency: skip if primary report already exists
  const existingReport = await findPrimaryReportByRunId(runId);
  if (existingReport) return;

  const run = await findRunById(runId);
  if (!run) throw new Error(`Reconciliation run not found: ${runId}`);
  if (run.status !== 'COMPLETED') return;

  const user = await findUserById(run.user_id);

  // Fetch all data
  const [wbTxs, bankTxs, matches, wbErrors, bankErrors] = await Promise.all([
    findTransactionsByImportId(run.wb_import_id),
    findTransactionsByImportId(run.bank_import_id),
    findMatchesByRunId(runId),
    findParsingErrorsByImportId(run.wb_import_id),
    findParsingErrorsByImportId(run.bank_import_id),
  ]);

  // Build transaction lookup map
  const txMap = new Map<string, CanonicalTransaction>();
  for (const tx of [...wbTxs, ...bankTxs]) txMap.set(tx.id, tx);

  // Process matches
  const matchedRows: MatchedRow[] = [];
  const ambiguousRows: { match_id: string; wb_tx: CanonicalTransaction; candidates_count: number }[] = [];
  const evidenceRows: { match_id: string; match_type: string; evidence: NonNullable<Awaited<ReturnType<typeof findEvidenceByMatchId>>> }[] = [];
  const matchedWbTxIds = new Set<string>();

  for (const match of matches) {
    const items = await findMatchItemsByMatchId(match.id);
    const wbItems = items.filter((i) => i.side === 'WB');
    const bankItems = items.filter((i) => i.side === 'BANK');

    if (
      match.match_type === 'MATCHED' ||
      match.match_type === 'SPLIT_MATCHED' ||
      match.match_type === 'COMBINED_MATCHED'
    ) {
      for (const wbItem of wbItems) {
        matchedWbTxIds.add(wbItem.transaction_id);
        for (const bankItem of bankItems) {
          matchedRows.push({
            match_id: match.id,
            match_type: match.match_type ?? 'MATCHED',
            final_score: match.final_score,
            wb_tx: txMap.get(wbItem.transaction_id),
            bank_tx: txMap.get(bankItem.transaction_id),
          });
        }
      }

      const evidence = await findEvidenceByMatchId(match.id);
      if (evidence) {
        evidenceRows.push({
          match_id: match.id,
          match_type: match.match_type ?? 'MATCHED',
          evidence,
        });
      }
    } else if (match.match_type === 'AMBIGUOUS') {
      for (const wbItem of wbItems) {
        matchedWbTxIds.add(wbItem.transaction_id);
        const wbTx = txMap.get(wbItem.transaction_id);
        if (wbTx) {
          ambiguousRows.push({
            match_id: match.id,
            wb_tx: wbTx,
            candidates_count: bankItems.length,
          });
        }
      }
    }
  }

  // Unmatched WB transactions
  const unmatchedWbTxs = wbTxs.filter((tx) => !matchedWbTxIds.has(tx.id));

  // Loss estimate: unmatched + 50% of ambiguous
  const lossEstimate = computeLossEstimate(run);

  // Build CSV files
  const csvFiles: Record<string, string> = {
    'summary.csv': buildSummaryCSV(run, lossEstimate),
    'matched.csv': buildMatchedCSV(matchedRows),
    'unmatched.csv': buildUnmatchedCSV(unmatchedWbTxs),
    'ambiguous.csv': buildAmbiguousCSV(ambiguousRows),
    'wb_rows.csv': buildAllTransactionsCSV(wbTxs),
    'bank_rows.csv': buildAllTransactionsCSV(bankTxs),
    'evidence.csv': buildEvidenceCSV(evidenceRows),
    'parsing_errors.csv': buildParsingErrorsCSV([...wbErrors, ...bankErrors]),
    'metrics.csv': buildMetricsCSV(run),
  };

  // Create ZIP archive
  const zipBuffer = await createZip(csvFiles);

  // Store ZIP in filesystem/storage
  const storagePath = await storeReport(runId, zipBuffer);

  // Create report record in DB
  await createReport({
    run_id: runId,
    storage_path: storagePath,
    export_type: 'ZIP',
    report_version: 1,
    is_primary: true,
  });

  // Send ZIP file to user via Telegram
  if (user?.telegram_id && process.env.NODE_ENV !== 'test') {
    const caption = `Отчёт по сверке ${runId} готов. Содержит сводку, совпадения, расхождения и детали оценки.`;
    await sendDocumentToUser(
      user.telegram_id,
      zipBuffer,
      `report_${runId.slice(0, 8)}.zip`,
      caption,
    );
  }
}
