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
import { buildHtmlReport, type ClaimRow } from '@/src/lib/reports/htmlReport';
import { buildClaimCSV } from '@/src/lib/reports/claimBuilder';

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

  const existingReport = await findPrimaryReportByRunId(runId);
  if (existingReport) return;

  const run = await findRunById(runId);
  if (!run) throw new Error(`Reconciliation run not found: ${runId}`);
  if (run.status !== 'COMPLETED') return;

  const user = await findUserById(run.user_id);

  const [wbTxs, bankTxs, matches, wbErrors, bankErrors] = await Promise.all([
    findTransactionsByImportId(run.wb_import_id),
    findTransactionsByImportId(run.bank_import_id),
    findMatchesByRunId(runId),
    findParsingErrorsByImportId(run.wb_import_id),
    findParsingErrorsByImportId(run.bank_import_id),
  ]);

  const txMap = new Map<string, CanonicalTransaction>();
  for (const tx of [...wbTxs, ...bankTxs]) txMap.set(tx.id, tx);

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

  const unmatchedWbTxs = wbTxs.filter((tx) => !matchedWbTxIds.has(tx.id));
  const lossEstimate = computeLossEstimate(run);

  let expectedKopeks = BigInt(0);
  let receivedKopeks = BigInt(0);
  let aggStatus: 'reconciled' | 'underpaid' | 'missing' | 'overpaid' = 'reconciled';
  for (const match of matches) {
    const ev = await findEvidenceByMatchId(match.id);
    const pen = ev?.penalties as Record<string, unknown> | undefined;
    if (pen && pen.strategy === 'wb_net_payout') {
      expectedKopeks = BigInt(String(pen.expected_net_kopeks ?? '0'));
      receivedKopeks = BigInt(String(pen.received_kopeks ?? '0'));
      aggStatus = (pen.status as typeof aggStatus) ?? 'reconciled';
      break;
    }
  }
  const lossKopeks = expectedKopeks - receivedKopeks > BigInt(0) ? expectedKopeks - receivedKopeks : BigInt(0);
  const matchRate = run.match_rate ? Number(run.match_rate) : aggStatus === 'reconciled' || aggStatus === 'overpaid' ? 100 : 0;

  const fmtDmy = (d: Date | string | null | undefined): string => {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
  };
  const claimRows: ClaimRow[] = unmatchedWbTxs.map((tx) => ({
    dateStr: fmtDmy(tx.transaction_date),
    amountKopeks: tx.amount_kopeks ?? BigInt(0),
    reference: tx.reference,
    description: tx.description,
  }));

  const htmlReport = buildHtmlReport({
    runId,
    dateStr: fmtDmy(run.created_at),
    status: aggStatus,
    expectedKopeks,
    receivedKopeks,
    lossKopeks,
    matchRate,
    claimRows,
  });

  const htmlBuffer = Buffer.from(htmlReport, 'utf-8');
  const storagePath = await storeReport(runId, htmlBuffer);

  await createReport({
    run_id: runId,
    storage_path: storagePath,
    export_type: 'HTML',
    report_version: 1,
    is_primary: true,
  });
}
