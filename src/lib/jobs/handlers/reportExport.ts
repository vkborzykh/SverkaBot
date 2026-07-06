import type { Job } from '@/src/db/repositories/jobs';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findMatchesByRunId } from '@/src/db/repositories/reconciliation-matches';
import { findMatchItemsByMatchId } from '@/src/db/repositories/reconciliation-match-items';
import { findEvidenceByMatchId } from '@/src/db/repositories/reconciliation-evidence';
import { findTransactionsByImportId, type CanonicalTransaction } from '@/src/db/repositories/canonical-transactions';
import { findUserById } from '@/src/db/repositories/users';
import { findImportById } from '@/src/db/repositories/imports';
import { findCabinetById } from '@/src/db/repositories/wb-cabinets';
import { findPrimaryReportByRunId, createReport, findReportByRunIdAndType } from '@/src/db/repositories/reports';
import { storeReport, storeReportCsv } from '@/src/lib/ingestion/storage';
import { buildHtmlReport, type ClaimRow, type ReportTxRow } from '@/src/lib/reports/htmlReport';
import { clearSession } from '@/src/lib/telegram/session';
import { msg } from '@/src/lib/telegram/messages.ru';
import { reconciliationFinishedKeyboard } from '@/src/lib/telegram/keyboard';
import { reportRetentionDaysFor, hasBusinessFeatures } from '@/src/lib/billing/tariffs';
import { buildCsvForRun } from '@/src/lib/reports/csvExport';

const MAX_REPORT_ROWS = 500;

async function sendMessageToUser(telegramId: bigint, text: string, keyboard?: any): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const body: any = { chat_id: String(telegramId), text };
    if (keyboard) body.reply_markup = keyboard.reply_markup;
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[reportExport] sendMessageToUser error:', err);
  }
}

function rub(kopeks: bigint): string {
  const neg = kopeks < BigInt(0);
  const a = neg ? -kopeks : kopeks;
  const whole = (a / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  const cents = (a % BigInt(100)).toString().padStart(2, '0');
  return `${neg ? '−' : ''}${whole},${cents}\u00A0₽`;
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

  // cabinet name
  let cabinetName: string | null = null;
  try {
    const wbImport = await findImportById(run.wb_import_id);
    const cabId = (wbImport as { cabinet_id?: string | null } | undefined)?.cabinet_id;
    if (cabId) {
      cabinetName = (await findCabinetById(cabId))?.name ?? null;
    }
  } catch (err) {
    console.error('[reportExport] cabinet lookup failed:', err);
  }

  const [wbTxs, bankTxs, matches] = await Promise.all([
    findTransactionsByImportId(run.wb_import_id),
    findTransactionsByImportId(run.bank_import_id),
    findMatchesByRunId(runId),
  ]);

  let grossPayoutKopeks = BigInt(0);
  let commissionsKopeks = BigInt(0);
  let expectedKopeks = BigInt(0);
  let receivedKopeks = BigInt(0);
  let aggStatus: 'reconciled' | 'underpaid' | 'missing' | 'overpaid' = 'reconciled';
  const matchedBankTxIds = new Set<string>();
  for (const match of matches) {
    const [ev, items] = await Promise.all([
      findEvidenceByMatchId(match.id),
      findMatchItemsByMatchId(match.id),
    ]);
    for (const it of items) {
      if (it.side === 'BANK') matchedBankTxIds.add(it.transaction_id);
    }
    const pen = ev?.penalties as Record<string, unknown> | undefined;
    if (pen && pen.strategy === 'wb_net_payout') {
      grossPayoutKopeks = BigInt(String(pen.wb_in_kopeks ?? '0'));
      commissionsKopeks = BigInt(String(pen.wb_out_kopeks ?? '0'));
      expectedKopeks = BigInt(String(pen.expected_net_kopeks ?? '0'));
      receivedKopeks = BigInt(String(pen.received_kopeks ?? '0'));
      aggStatus = (pen.status as typeof aggStatus) ?? 'reconciled';
    }
  }
  const lossKopeks = expectedKopeks - receivedKopeks > BigInt(0) ? expectedKopeks - receivedKopeks : BigInt(0);
  const lossPercent =
    lossKopeks > BigInt(0) && expectedKopeks > BigInt(0)
      ? Number(((Number(lossKopeks) / Number(expectedKopeks)) * 100).toFixed(1))
      : null;
  const matchRate = run.match_rate ? Number(run.match_rate) : aggStatus === 'reconciled' || aggStatus === 'overpaid' ? 100 : 0;

  const fmtDmy = (d: Date | string | null | undefined): string => {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
  };
  const timeOf = (d: Date | string | null | undefined): number => {
    const t = d ? new Date(d).getTime() : NaN;
    return isNaN(t) ? 0 : t;
  };
  const toRow = (tx: CanonicalTransaction): ReportTxRow => ({
    dateStr: fmtDmy(tx.transaction_date),
    amountKopeks: tx.amount_kopeks ?? BigInt(0),
    direction: (tx.direction as string) === 'OUT' ? 'OUT' : 'IN',
    description: tx.description,
    reference: tx.reference,
    counterparty: tx.counterparty,
  });

  const wbSorted = [...wbTxs].sort((a, b) => timeOf(a.transaction_date) - timeOf(b.transaction_date));
  const bankCredits = [...bankTxs].filter((t) => ((t.direction as string) ?? 'IN') !== 'OUT').sort((a, b) => timeOf(a.transaction_date) - timeOf(b.transaction_date));
  const wbBankCredits = bankCredits.filter((t) => matchedBankTxIds.has(t.id));
  const wbRows = wbSorted.slice(0, MAX_REPORT_ROWS).map(toRow);
  const bankRows = wbBankCredits.slice(0, MAX_REPORT_ROWS).map(toRow);

  const unidentified = bankCredits.filter((t) => !matchedBankTxIds.has(t.id));
  const unidentifiedTotalKopeks = unidentified.reduce((s, t) => s + (t.amount_kopeks ?? BigInt(0)), BigInt(0));
  const unidentifiedRows = unidentified.slice(0, MAX_REPORT_ROWS).map(toRow);

  const claimAmountKopeks = lossKopeks;
  const wbTimes = wbTxs.map((t) => timeOf(t.transaction_date)).filter((n) => n > 0);
  const claimPeriod = wbTimes.length ? `${fmtDmy(new Date(Math.min(...wbTimes)))} – ${fmtDmy(new Date(Math.max(...wbTimes)))}` : fmtDmy(run.created_at);
  const claimRows: ClaimRow[] = wbSorted.filter((tx) => ((tx.direction as string) ?? 'IN') !== 'OUT').slice(0, MAX_REPORT_ROWS).map((tx) => ({
    dateStr: fmtDmy(tx.transaction_date),
    amountKopeks: tx.amount_kopeks ?? BigInt(0),
    reference: tx.reference,
    description: tx.description,
  }));

  const csvRequested =
    Boolean((job.payload as Record<string, unknown>)?.csv_export) ||
    hasBusinessFeatures(user?.tariff);

  const htmlReport = buildHtmlReport({
    runId,
    dateStr: fmtDmy(run.created_at),
    cabinetName,
    exportCsvCommand: csvRequested ? `/export_csv ${runId}` : null,
    status: aggStatus,
    grossPayoutKopeks,
    commissionsKopeks,
    expectedKopeks,
    receivedKopeks,
    lossKopeks,
    lossPercent,
    matchRate,
    wbRows,
    wbRowsTotal: wbTxs.length,
    bankRows,
    bankRowsTotal: wbBankCredits.length,
    unidentifiedRows,
    unidentifiedRowsTotal: unidentified.length,
    unidentifiedTotalKopeks,
    claimAmountKopeks,
    claimPeriod,
    claimRows,
  });

  const htmlBuffer = Buffer.from(htmlReport, 'utf-8');
  const storagePath = await storeReport(runId, htmlBuffer, 'text/html');

  const retentionDays = user?.tariff
    ? reportRetentionDaysFor(user.tariff)
    : 90;

  await createReport({
    run_id: runId,
    storage_path: storagePath,
    export_type: 'HTML',
    report_version: 1,
    is_primary: true,
    retention_days: retentionDays,
  });

  // ➕ CSV-выгрузка для тарифа «Бизнес»
  if (csvRequested) {
    try {
      const existingCsv = await findReportByRunIdAndType(runId, 'CSV');
      if (!existingCsv) {
        const csvBuffer = await buildCsvForRun(run);
        const csvPath = await storeReportCsv(runId, csvBuffer);
        await createReport({
          run_id: runId,
          storage_path: csvPath,
          export_type: 'CSV',
          report_version: 1,
          is_primary: false,
          retention_days: retentionDays,
        });
      }
    } catch (err) {
      console.error('[reportExport] CSV generation failed (non-fatal):', err);
    }
  }

  if (process.env.PUBLIC_URL && process.env.INTERNAL_TOKEN) {
    try {
      await fetch(`${process.env.PUBLIC_URL}/api/reports/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': process.env.INTERNAL_TOKEN },
        body: JSON.stringify({ run_id: runId }),
      });
    } catch (e) { console.error('[reportExport] delivery error:', e); }
  }

  if (user?.telegram_id) {
    if (lossKopeks > BigInt(0)) {
      await sendMessageToUser(user.telegram_id, `🔍 Обнаружена недоплата: ${rub(lossKopeks)}. Отчёт отправлен.`);
    }
    await clearSession(user.telegram_id);
    await sendMessageToUser(user.telegram_id, msg.reconciliationCompleted, reconciliationFinishedKeyboard);
  }
}
