import { findMatchesByRunId } from '@/src/db/repositories/reconciliation-matches';
import { findMatchItemsByMatchId } from '@/src/db/repositories/reconciliation-match-items';
import { findTransactionsByImportId } from '@/src/db/repositories/canonical-transactions';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import {
  createMatches,
  type NewReconciliationMatch,
} from '@/src/db/repositories/reconciliation-matches';
import {
  createMatchItems,
  type NewReconciliationMatchItem,
} from '@/src/db/repositories/reconciliation-match-items';
import { getSetting } from '@/src/lib/settings/settings';
import { getDb } from '@/src/db/index';
import { reconciliation_matches } from '@/src/db/schema';
import { inArray } from 'drizzle-orm';

type TxRow = {
  id: string;
  amount_kopeks: bigint | null;
  transaction_date: Date | string | null;
  source_type: string | null;
  direction: string | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysDiff(a: Date | string | null, b: Date | string | null): number {
  if (!a || !b) return Infinity;
  return (
    Math.abs(new Date(a as string).getTime() - new Date(b as string).getTime()) /
    86_400_000
  );
}

/**
 * Generate all subsets of an array of a given size (non-generator version for ES5 compat).
 */
function subsets<T>(arr: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (arr.length < size) return [];
  const result: T[][] = [];
  for (let i = 0; i <= arr.length - size; i++) {
    const tail = subsets(arr.slice(i + 1), size - 1);
    for (const rest of tail) {
      result.push([arr[i], ...rest]);
    }
  }
  return result;
}

async function deleteMatchesByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  await db
    .delete(reconciliation_matches)
    .where(inArray(reconciliation_matches.id, ids));
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function detectSplitCombined(runId: string): Promise<void> {
  const run = await findRunById(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);

  const maxCluster =
    (await getSetting<number>('split_combined_max_rows')) ?? 3;
  const dateWindowDays =
    (await getSetting<number>('date_window_days')) ?? 7;

  const [wbTxs, bankTxs] = await Promise.all([
    findTransactionsByImportId(run.wb_import_id),
    findTransactionsByImportId(run.bank_import_id),
  ]);

  const txById = new Map<string, TxRow>();
  for (const tx of [...wbTxs, ...bankTxs]) txById.set(tx.id, tx as TxRow);

  // Find already matched tx IDs
  const existingMatches = await findMatchesByRunId(runId);
  const matchedWbIds = new Set<string>();
  const matchedBankIds = new Set<string>();
  const matchIdByWb = new Map<string, string>(); // wb_tx_id → match_id
  const matchIdByBank = new Map<string, string>();

  for (const m of existingMatches) {
    if (m.match_type !== 'MATCHED') continue;
    const items = await findMatchItemsByMatchId(m.id);
    for (const item of items) {
      if (item.side === 'WB') {
        matchedWbIds.add(item.transaction_id);
        matchIdByWb.set(item.transaction_id, m.id);
      } else {
        matchedBankIds.add(item.transaction_id);
        matchIdByBank.set(item.transaction_id, m.id);
      }
    }
  }

  const unmatchedWb = wbTxs.filter((t) => !matchedWbIds.has(t.id)) as TxRow[];
  const unmatchedBank = bankTxs.filter((t) => !matchedBankIds.has(t.id)) as TxRow[];

  const processedWb = new Set<string>();
  const processedBank = new Set<string>();

  // ── Detect SPLIT: 1 WB → 2–maxCluster bank ──────────────────────────────

  for (const wb of unmatchedWb) {
    if (processedWb.has(wb.id)) continue;
    const wbAmount = wb.amount_kopeks ?? BigInt(0);
    const wbDate = wb.transaction_date;

    for (let size = 2; size <= maxCluster; size++) {
      let found = false;

      // Consider bank transactions within date window
      const candidates = unmatchedBank.filter(
        (b) =>
          !processedBank.has(b.id) &&
          daysDiff(wbDate, b.transaction_date) <= dateWindowDays,
      );

      for (const group of subsets(candidates, size)) {
        const sum = group.reduce(
          (s, b) => s + (b.amount_kopeks ?? BigInt(0)),
          BigInt(0),
        );
        if (sum !== wbAmount) continue;

        // Valid split found
        const matchesToDelete: string[] = [];
        // Remove any existing partial individual matches for these bank txs
        for (const b of group) {
          const mId = matchIdByBank.get(b.id);
          if (mId) matchesToDelete.push(mId);
        }
        await deleteMatchesByIds(matchesToDelete);

        const newMatch: NewReconciliationMatch = {
          run_id: runId,
          match_type: 'SPLIT_MATCHED',
          final_score: '0.8000',
        };
        const [created] = await createMatches([newMatch]);
        const matchId = created.id;

        const items: NewReconciliationMatchItem[] = [
          { match_id: matchId, transaction_id: wb.id, side: 'WB' },
          ...group.map((b) => ({
            match_id: matchId,
            transaction_id: b.id,
            side: 'BANK' as const,
          })),
        ];
        await createMatchItems(items);

        processedWb.add(wb.id);
        for (const b of group) processedBank.add(b.id);

        found = true;
        break;
      }
      if (found) break;
    }
  }

  // ── Detect COMBINED: 2–maxCluster WB → 1 bank ────────────────────────────

  const stillUnmatchedWb = unmatchedWb.filter(
    (t) => !processedWb.has(t.id),
  );
  const stillUnmatchedBank = unmatchedBank.filter(
    (t) => !processedBank.has(t.id),
  );

  for (const bank of stillUnmatchedBank) {
    if (processedBank.has(bank.id)) continue;
    const bankAmount = bank.amount_kopeks ?? BigInt(0);
    const bankDate = bank.transaction_date;

    for (let size = 2; size <= maxCluster; size++) {
      let found = false;

      const candidates = stillUnmatchedWb.filter(
        (w) =>
          !processedWb.has(w.id) &&
          daysDiff(bankDate, w.transaction_date) <= dateWindowDays,
      );

      for (const group of subsets(candidates, size)) {
        const sum = group.reduce(
          (s, w) => s + (w.amount_kopeks ?? BigInt(0)),
          BigInt(0),
        );
        if (sum !== bankAmount) continue;

        // Valid combined found
        const newMatch: NewReconciliationMatch = {
          run_id: runId,
          match_type: 'COMBINED_MATCHED',
          final_score: '0.8000',
        };
        const [created] = await createMatches([newMatch]);
        const matchId = created.id;

        const items: NewReconciliationMatchItem[] = [
          ...group.map((w) => ({
            match_id: matchId,
            transaction_id: w.id,
            side: 'WB' as const,
          })),
          { match_id: matchId, transaction_id: bank.id, side: 'BANK' },
        ];
        await createMatchItems(items);

        processedBank.add(bank.id);
        for (const w of group) processedWb.add(w.id);

        found = true;
        break;
      }
      if (found) break;
    }
  }
}
