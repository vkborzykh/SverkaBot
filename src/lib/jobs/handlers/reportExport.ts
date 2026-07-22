import type { Job } from '@/src/db/repositories/jobs';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findMatchesByRunId } from '@/src/db/repositories/reconciliation-matches';
import { findMatchItemsByMatchId } from '@/src/db/repositories/reconciliation-match-items';
import { findEvidenceByMatchId } from '@/src/db/repositories/reconciliation-evidence';
import { findTransactionsByImportId, type CanonicalTransaction } from '@/src/db/repositories/canonical-transactions';
import { findUserById } from '@/src/db/repositories/users';
import { findImportById } from '@/src/db/repositories/imports';
import { findCabinetById } from '@/src/db/repositories/wb-cabinets';
import { findPrimaryReportByRunId, createReport } from '@/src/db/repositories/reports';
import { storeReport } from '@/src/lib/ingestion/storage';
import { buildHtmlReport, type ClaimRow, type ReportTxRow } from '@/src/lib/reports/htmlReport';
import { buildRowLevelClaim } from '@/src/lib/reconciliation/claimBuilder';
import { clearSession } from '@/src/lib/telegram/session';
import { msg } from '@/src/lib/telegram/messages.ru';
import { getReconciliationFinishedKeyboard } from '@/src/lib/telegram/keyboard';
import { hasExportAccess, reportRetentionDaysFor } from '@/src/lib/billing/tariffs';

const MAX_REPORT_ROWS = 500;

async function sendDocumentToUser(telegramId: bigint, buffer: Buffer, filename: string, caption: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const blob = new Blob([buffer], { type: 'text/html' });
    const formData = new FormData();
    formData.append('chat_id', String(telegramId));
    formData.append('document', blob, filename);
    formData.append('caption', caption);
    await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: formData,
    });
  } catch (err) {
    console.error('[reportExport] sendDocumentToUser error:', err);
  }
}

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
  type AggStatus = 'reconciled' | 'underpaid' | 'missing' | 'overpaid';
  let aggStatus: AggStatus = 'reconciled';
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
      aggStatus = (pen.status as AggStatus) ?? 'reconciled';
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

  let claimAmountKopeks = lossKopeks;
  const wbTimes = wbTxs.map((t) => timeOf(t.transaction_date)).filter((n) => n > 0);
  const claimPeriod = wbTimes.length ? `${fmtDmy(new Date(Math.min(...wbTimes)))} – ${fmtDmy(new Date(Math.max(...wbTimes)))}` : fmtDmy(run.created_at);

  // Пытаемся построить построчную претензию (конкретные WB-строки без
  // соответствующего поступления в банке). При низкой уверенности или
  // отсутствии данных — откат на старый агрегатный список (все начисления
  // WB за период, помечено соответствующей оговоркой в htmlReport.ts).
  let claimRows: ClaimRow[];
  let claimIsRowLevel = false;
  const rowLevelClaim = await buildRowLevelClaim(runId, wbTxs, lossKopeks);
  if (rowLevelClaim && rowLevelClaim.confidence === 'high' && rowLevelClaim.rows.length > 0) {
    claimRows = rowLevelClaim.rows.slice(0, MAX_REPORT_ROWS);
    claimAmountKopeks = rowLevelClaim.sumUnmatchedKopeks;
    claimIsRowLevel = true;
  } else {
    claimRows = wbSorted.filter((tx) => ((tx.direction as string) ?? 'IN') !== 'OUT').slice(0, MAX_REPORT_ROWS).map((tx) => ({
      dateStr: fmtDmy(tx.transaction_date),
      amountKopeks: tx.amount_kopeks ?? BigInt(0),
      reference: tx.reference,
      description: tx.description,
    }));
  }

  const htmlReport = buildHtmlReport({
    runId,
    dateStr: fmtDmy(run.created_at),
    cabinetName,
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
    claimIsRowLevel,
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

  // Отправляем HTML-отчёт напрямую пользователю, минуя несуществующий внутренний API
  if (user?.telegram_id) {
    try {
      await sendDocumentToUser(
        user.telegram_id,
        htmlBuffer,
        `report_${runId.slice(0, 8)}.html`,
        msg.reportCaption,
      );
    } catch (err) {
      console.error('[reportExport] failed to send report to user:', err);
    }

    // Кнопка «Выгрузить для бухгалтера» – отправляется только здесь, СРАЗУ ПОСЛЕ
    // фактической доставки HTML-отчёта, а не в reconcile.ts (там report_export
    // ещё не выполнялся, и порядок сообщений был бы гарантированно неверным).
    if (
      hasExportAccess(user) &&
      aggStatus === 'underpaid' &&
      lossKopeks > BigInt(0)
    ) {
      await sendMessageToUser(user.telegram_id, '📥 Хотите выгрузить эту сверку для бухгалтера?', {
        reply_markup: {
          inline_keyboard: [[
            { text: '📗 Выгрузить XLSX', callback_data: `export_xlsx:${runId}` },
          ]],
        },
      });
    }

    await clearSession(user.telegram_id);
    await sendMessageToUser(
      user.telegram_id,
      msg.reconciliationCompleted,
      getReconciliationFinishedKeyboard(runId),
    );
  }
}
