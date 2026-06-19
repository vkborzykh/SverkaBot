// Pure core of the WB net-payout reconciliation — no DB/framework imports, so it
// can be unit-tested in isolation. `wbPayout.ts` wraps this with persistence.
//
//   expected_net = Σ(WB IN)  −  Σ(WB OUT)     // payouts minus returns + deductions
//   received     = Σ(bank IN credits identified as Wildberries)
//   discrepancy  = expected_net − received     // > 0 ⇒ underpayment (potential loss)

export interface PayoutTx {
  id: string;
  direction: 'IN' | 'OUT' | null;
  amount_kopeks: bigint | null;
  counterparty: string | null;
  description: string | null;
}

export type MatchType = 'MATCHED' | 'COMBINED_MATCHED' | 'UNMATCHED';

export interface WbPayoutResult {
  status: 'reconciled' | 'underpaid' | 'missing' | 'overpaid';
  matchType: MatchType;
  expectedNetKopeks: bigint;
  wbInKopeks: bigint;
  wbOutKopeks: bigint;
  receivedKopeks: bigint;
  discrepancyKopeks: bigint;
  bankCreditCount: number;
  finalScore: number;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount: number;
  splitCount: number;
  combinedCount: number;
  unmatchedAmountKopeks: bigint;
  ambiguousAmountKopeks: bigint;
  matchRate: number;
  wbPayoutTxIds: string[];
  bankCreditTxIds: string[];
}

export interface ComputeOpts {
  keywords: string[];
  toleranceKopeks: bigint;
  tolerancePct: number;
}

export const DEFAULT_WB_KEYWORDS = ['вайлдбер', 'wildber', 'маркетплейс'];
export const DEFAULT_TOLERANCE_KOPEKS = 10000; // 100 ₽
export const DEFAULT_TOLERANCE_PCT = 0.5; // 0.5 %

const abs = (x: bigint): bigint => (x < BigInt(0) ? -x : x);
const sum = (xs: bigint[]): bigint => xs.reduce((a, b) => a + b, BigInt(0));

export function isWbCredit(tx: PayoutTx, keywords: string[]): boolean {
  const hay = `${tx.counterparty ?? ''} ${tx.description ?? ''}`.toLowerCase();
  return keywords.some((k) => hay.includes(k));
}

export function computeWbPayout(
  wbTxs: PayoutTx[],
  bankTxs: PayoutTx[],
  opts: ComputeOpts,
): WbPayoutResult {
  const wbIn = sum(wbTxs.filter((t) => t.direction === 'IN').map((t) => t.amount_kopeks ?? BigInt(0)));
  const wbOut = sum(wbTxs.filter((t) => t.direction === 'OUT').map((t) => t.amount_kopeks ?? BigInt(0)));
  const expectedNet = wbIn - wbOut;

  const bankCredits = bankTxs.filter((t) => t.direction === 'IN' && isWbCredit(t, opts.keywords));
  const received = sum(bankCredits.map((t) => t.amount_kopeks ?? BigInt(0)));

  const discrepancy = expectedNet - received;
  const tolPct = (expectedNet * BigInt(Math.round(opts.tolerancePct * 100))) / BigInt(10000);
  const tolerance = tolPct > opts.toleranceKopeks ? tolPct : opts.toleranceKopeks;
  const reconciled = abs(discrepancy) <= tolerance;

  let status: WbPayoutResult['status'];
  let matchType: MatchType;
  let matchedCount = 0;
  let unmatchedCount = 0;
  let combinedCount = 0;
  let unmatchedAmount = BigInt(0);

  if (reconciled) {
    status = 'reconciled';
    matchType = bankCredits.length > 1 ? 'COMBINED_MATCHED' : 'MATCHED';
    matchedCount = 1;
    combinedCount = bankCredits.length > 1 ? 1 : 0;
  } else if (discrepancy < BigInt(0)) {
    status = 'overpaid';
    matchType = bankCredits.length > 1 ? 'COMBINED_MATCHED' : 'MATCHED';
    matchedCount = 1;
    combinedCount = bankCredits.length > 1 ? 1 : 0;
  } else if (received === BigInt(0)) {
    status = 'missing';
    matchType = 'UNMATCHED';
    unmatchedCount = 1;
    unmatchedAmount = expectedNet > BigInt(0) ? expectedNet : BigInt(0);
  } else {
    status = 'underpaid';
    matchType = 'UNMATCHED';
    unmatchedCount = 1;
    unmatchedAmount = discrepancy;
  }

  const denom = expectedNet > BigInt(0) ? expectedNet : BigInt(1);
  const ratio = 1 - Number(abs(discrepancy)) / Number(denom);
  const finalScore = Math.max(0, Math.min(1, reconciled ? Math.max(ratio, 0.95) : Math.max(ratio, 0)));

  // ── Исправленный расчёт matchRate ──
  let matchRate: number;
  if (status === 'reconciled' || status === 'overpaid') {
    matchRate = 100;
  } else if (status === 'missing') {
    matchRate = 0;
  } else { // underpaid
    matchRate = expectedNet > BigInt(0) ? (Number(received) / Number(expectedNet)) * 100 : 0;
    // Округляем до двух знаков, чтобы избежать погрешностей
    matchRate = Math.round(matchRate * 100) / 100;
  }

  return {
    status,
    matchType,
    expectedNetKopeks: expectedNet,
    wbInKopeks: wbIn,
    wbOutKopeks: wbOut,
    receivedKopeks: received,
    discrepancyKopeks: discrepancy,
    bankCreditCount: bankCredits.length,
    finalScore,
    matchedCount,
    unmatchedCount,
    ambiguousCount: 0,
    splitCount: 0,
    combinedCount,
    unmatchedAmountKopeks: unmatchedAmount,
    ambiguousAmountKopeks: BigInt(0),
    matchRate,
    wbPayoutTxIds: wbTxs.filter((t) => t.direction === 'IN').map((t) => t.id),
    bankCreditTxIds: bankCredits.map((t) => t.id),
  };
}
