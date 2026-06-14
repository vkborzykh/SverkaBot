import { normalizeText } from '@/src/lib/parsing/normalize/text';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScoringWeights {
  amount_weight: number;
  date_weight: number;
  reference_weight: number;
  description_weight: number;
  counterparty_weight: number;
  date_window_days: number;
  penalty_factor: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  amount_weight: 0.5,
  date_weight: 0.3,
  reference_weight: 0.1,
  description_weight: 0.05,
  counterparty_weight: 0.05,
  date_window_days: 7,
  penalty_factor: 0.2,
};

export interface TxFields {
  amount_kopeks: bigint;
  transaction_date: Date;
  direction: 'IN' | 'OUT';
  currency?: string | null;
  reference?: string | null;
  description?: string | null;
  counterparty?: string | null;
}

export interface ScoreResult {
  score: number;
  components: Record<string, number>;
  penalties: string[];
  reasonCodes: string[];
}

// ── Keyword lists ─────────────────────────────────────────────────────────────

const WB_KEYWORDS = [
  'wildberries', 'вайлдберриз', 'вб', 'выплата', 'wb',
  'маркетплейс', 'marketplace',
];

const FEE_KEYWORDS = [
  'комиссия', 'комиссионное', 'обслуживание', 'fee', 'commission',
  'sms', 'смс', 'страховк', 'обслуж',
];

const REFUND_KEYWORDS = [
  'возврат', 'refund', 'chargeback', 'чарджбэк', 'reversal', 'отмена',
];

const INTERNAL_KEYWORDS = [
  'внутренний перевод', 'internal transfer', 'собственные средства',
  'перевод между счетами',
];

const SUSPICIOUS_KEYWORDS = [
  'сомнительн', 'подозрительн', 'suspicious',
];

// ── Component calculators ─────────────────────────────────────────────────────

function amountScore(wb: TxFields, bank: TxFields): number {
  return wb.amount_kopeks === bank.amount_kopeks ? 1.0 : 0.0;
}

function dateScore(wb: TxFields, bank: TxFields, windowDays: number): number {
  const diffMs = Math.abs(
    wb.transaction_date.getTime() - bank.transaction_date.getTime(),
  );
  const diffDays = diffMs / 86_400_000;
  if (diffDays > windowDays) return 0;
  if (windowDays === 0) return 1;
  return 1 - diffDays / windowDays;
}

function tokenSet(s: string): Set<string> {
  return new Set(
    normalizeText(s)
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0.5;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  a.forEach((t) => { if (b.has(t)) intersection++; });
  return intersection / (a.size + b.size - intersection);
}

function referenceScore(wb: TxFields, bank: TxFields): number {
  const wbRef = normalizeText(wb.reference ?? '');
  const bankRef = normalizeText(bank.reference ?? '');
  if (!wbRef || !bankRef) return 0;
  if (wbRef === bankRef) return 1.0;
  if (wbRef.includes(bankRef) || bankRef.includes(wbRef)) return 0.5;
  return 0;
}

function descriptionScore(wb: TxFields, bank: TxFields): number {
  const wbDesc = normalizeText(wb.description ?? '');
  const bankDesc = normalizeText(bank.description ?? '');

  // Boost if bank description contains WB-related keywords
  const bankHasWb = WB_KEYWORDS.some((k) => bankDesc.includes(k));
  if (bankHasWb) return 1.0;

  if (!wbDesc && !bankDesc) return 0.5;
  if (!wbDesc || !bankDesc) return 0.5;

  const sim = jaccardSimilarity(tokenSet(wbDesc), tokenSet(bankDesc));
  return Math.max(0.3, sim);
}

function counterpartyScore(wb: TxFields, bank: TxFields): number {
  const wbCp = normalizeText(wb.counterparty ?? '');
  const bankCp = normalizeText(bank.counterparty ?? '');

  // If both contain WB/Wildberries — strong signal
  const wbMatch = (s: string) => WB_KEYWORDS.some((k) => s.includes(k));
  if (wbMatch(wbCp) || wbMatch(bankCp)) return 1.0;

  if (!wbCp || !bankCp) return 0;
  if (wbCp === bankCp) return 1.0;
  if (wbCp.includes(bankCp) || bankCp.includes(wbCp)) return 0.5;
  return 0;
}

// ── Penalty detection ─────────────────────────────────────────────────────────

function detectPenalties(wb: TxFields, bank: TxFields): string[] {
  const combined = [
    normalizeText(wb.description ?? ''),
    normalizeText(bank.description ?? ''),
    normalizeText(wb.counterparty ?? ''),
    normalizeText(bank.counterparty ?? ''),
  ].join(' ');

  const penalties: string[] = [];

  if (FEE_KEYWORDS.some((k) => combined.includes(k))) penalties.push('FEE');
  if (REFUND_KEYWORDS.some((k) => combined.includes(k))) penalties.push('REFUND');
  if (combined.includes('чарджбэк') || combined.includes('chargeback')) {
    penalties.push('CHARGEBACK');
  }
  if (INTERNAL_KEYWORDS.some((k) => combined.includes(k))) penalties.push('INTERNAL_TRANSFER');
  if (SUSPICIOUS_KEYWORDS.some((k) => combined.includes(k))) penalties.push('SUSPICIOUS_PURPOSE');

  return penalties;
}

// ── Reason codes ──────────────────────────────────────────────────────────────

function buildReasonCodes(
  components: Record<string, number>,
  penalties: string[],
  weights: ScoringWeights,
): string[] {
  const codes: string[] = [];

  if (components.amount_score < 1.0) codes.push('AMOUNT_MISMATCH');
  if (components.date_score < 0.3) codes.push('DATE_FAR');
  if (components.date_score === 0) codes.push('DATE_OUT_OF_WINDOW');
  if (components.reference_score === 1.0) codes.push('REFERENCE_MATCH');
  if (components.description_score >= 0.8) codes.push('DESCRIPTION_MATCH');
  if (components.counterparty_score >= 0.8) codes.push('COUNTERPARTY_MATCH');
  if (penalties.length > 0) codes.push(...penalties.map((p) => `PENALTY_${p}`));

  // High confidence signal
  const weightedScore =
    components.amount_score * weights.amount_weight +
    components.date_score * weights.date_weight +
    components.reference_score * weights.reference_weight +
    components.description_score * weights.description_weight +
    components.counterparty_score * weights.counterparty_weight;

  if (weightedScore >= 0.9) codes.push('HIGH_CONFIDENCE');
  else if (weightedScore >= 0.7) codes.push('MEDIUM_CONFIDENCE');

  return codes;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function scoreCandidate(
  wb: TxFields,
  bank: TxFields,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): ScoreResult {
  const components: Record<string, number> = {
    amount_score: amountScore(wb, bank),
    date_score: dateScore(wb, bank, weights.date_window_days),
    reference_score: referenceScore(wb, bank),
    description_score: descriptionScore(wb, bank),
    counterparty_score: counterpartyScore(wb, bank),
  };

  const weightedSum =
    components.amount_score * weights.amount_weight +
    components.date_score * weights.date_weight +
    components.reference_score * weights.reference_weight +
    components.description_score * weights.description_weight +
    components.counterparty_score * weights.counterparty_weight;

  const penalties = detectPenalties(wb, bank);
  const penaltyFactor = Math.max(
    0,
    1 - penalties.length * weights.penalty_factor,
  );

  const score = Math.min(1, Math.max(0, weightedSum * penaltyFactor));
  const reasonCodes = buildReasonCodes(components, penalties, weights);

  return { score, components, penalties, reasonCodes };
}
