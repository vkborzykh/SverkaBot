import { describe, it, expect } from 'vitest';
import { scoreCandidate, DEFAULT_WEIGHTS, type TxFields } from '@/src/lib/reconciliation/scoring';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeTx(overrides: Partial<TxFields> = {}): TxFields {
  return {
    amount_kopeks: BigInt(150000), // 1 500 RUB
    transaction_date: new Date('2025-03-15T10:00:00Z'),
    direction: 'IN',
    currency: 'RUB',
    reference: null,
    description: null,
    counterparty: null,
    ...overrides,
  };
}

const wb = makeTx({ description: 'выплата wildberries', counterparty: 'ООО Wildberries' });
const bankExact = makeTx({ description: 'выплата wildberries', counterparty: 'ООО Wildberries' });

// ── Amount score ──────────────────────────────────────────────────────────────

describe('amount component', () => {
  it('score 1.0 when amounts equal', () => {
    const r = scoreCandidate(wb, bankExact);
    expect(r.components.amount_score).toBe(1.0);
  });

  it('score 0.0 when amounts differ', () => {
    const r = scoreCandidate(wb, makeTx({ amount_kopeks: BigInt(200000) }));
    expect(r.components.amount_score).toBe(0.0);
  });
});

// ── Date score ────────────────────────────────────────────────────────────────

describe('date component', () => {
  it('score 1.0 when same day', () => {
    const r = scoreCandidate(wb, bankExact);
    expect(r.components.date_score).toBe(1.0);
  });

  it('linear decay over window', () => {
    const bank3daysLater = makeTx({ transaction_date: new Date('2025-03-18T10:00:00Z') });
    const r = scoreCandidate(wb, bank3daysLater, { ...DEFAULT_WEIGHTS, date_window_days: 7 });
    // diff = 3 days, window = 7 → score = 1 - 3/7 ≈ 0.571
    expect(r.components.date_score).toBeCloseTo(1 - 3 / 7, 4);
  });

  it('score 0 when beyond window', () => {
    const bankFar = makeTx({ transaction_date: new Date('2025-03-30T10:00:00Z') });
    const r = scoreCandidate(wb, bankFar, { ...DEFAULT_WEIGHTS, date_window_days: 7 });
    expect(r.components.date_score).toBe(0);
  });

  it('score 1.0 at exactly window boundary (0-day diff)', () => {
    const r = scoreCandidate(wb, makeTx({ transaction_date: new Date('2025-03-15T22:00:00Z') }));
    expect(r.components.date_score).toBeGreaterThan(0.8);
  });
});

// ── Reference score ───────────────────────────────────────────────────────────

describe('reference component', () => {
  it('score 1.0 on exact match', () => {
    const txRef = makeTx({ reference: 'WB-2025-00123' });
    const r = scoreCandidate(txRef, makeTx({ reference: 'WB-2025-00123' }));
    expect(r.components.reference_score).toBe(1.0);
  });

  it('score 0.5 on partial match', () => {
    const r = scoreCandidate(
      makeTx({ reference: 'WB-2025-00123' }),
      makeTx({ reference: 'WB-2025-00123-A' }),
    );
    expect(r.components.reference_score).toBe(0.5);
  });

  it('score 0 when either reference is empty', () => {
    const r = scoreCandidate(makeTx({ reference: 'ABC' }), makeTx({ reference: null }));
    expect(r.components.reference_score).toBe(0);
  });

  it('score 0 when both empty', () => {
    const r = scoreCandidate(makeTx({ reference: null }), makeTx({ reference: null }));
    expect(r.components.reference_score).toBe(0);
  });
});

// ── Description score ─────────────────────────────────────────────────────────

describe('description component', () => {
  it('score 1.0 when bank desc contains wildberries keyword', () => {
    const r = scoreCandidate(wb, makeTx({ description: 'выплата wildberries март 2025' }));
    expect(r.components.description_score).toBe(1.0);
  });

  it('score 1.0 for вайлдберриз keyword', () => {
    const r = scoreCandidate(wb, makeTx({ description: 'вайлдберриз выплата' }));
    expect(r.components.description_score).toBe(1.0);
  });

  it('score 0.5 when both descriptions are null', () => {
    const r = scoreCandidate(makeTx(), makeTx());
    expect(r.components.description_score).toBe(0.5);
  });

  it('returns value >= 0.3 for any non-null descriptions', () => {
    const r = scoreCandidate(
      makeTx({ description: 'оплата товара' }),
      makeTx({ description: 'перевод средств' }),
    );
    expect(r.components.description_score).toBeGreaterThanOrEqual(0.3);
  });
});

// ── Counterparty score ────────────────────────────────────────────────────────

describe('counterparty component', () => {
  it('score 1.0 when counterparty contains wildberries', () => {
    const r = scoreCandidate(makeTx({ counterparty: 'ООО Wildberries' }), makeTx());
    expect(r.components.counterparty_score).toBe(1.0);
  });

  it('score 1.0 on exact match', () => {
    const r = scoreCandidate(
      makeTx({ counterparty: 'ООО Ромашка' }),
      makeTx({ counterparty: 'ООО Ромашка' }),
    );
    expect(r.components.counterparty_score).toBe(1.0);
  });

  it('score 0 when both empty', () => {
    const r = scoreCandidate(makeTx({ counterparty: null }), makeTx({ counterparty: null }));
    expect(r.components.counterparty_score).toBe(0);
  });
});

// ── Penalties ─────────────────────────────────────────────────────────────────

describe('penalties', () => {
  it('FEE penalty applied when description contains комиссия', () => {
    const r = scoreCandidate(wb, makeTx({ description: 'комиссия за обслуживание' }));
    expect(r.penalties).toContain('FEE');
    expect(r.score).toBeLessThan(
      scoreCandidate(wb, makeTx({ description: 'выплата wildberries' })).score,
    );
  });

  it('REFUND penalty applied when description contains возврат', () => {
    const r = scoreCandidate(wb, makeTx({ description: 'возврат средств' }));
    expect(r.penalties).toContain('REFUND');
  });

  it('INTERNAL_TRANSFER penalty applied for внутренний перевод', () => {
    const r = scoreCandidate(wb, makeTx({ description: 'внутренний перевод между счетами' }));
    expect(r.penalties).toContain('INTERNAL_TRANSFER');
  });

  it('multiple penalties reduce score further', () => {
    const singlePenalty = scoreCandidate(wb, makeTx({ description: 'комиссия wildberries' }));
    const doublePenalty = scoreCandidate(
      wb,
      makeTx({ description: 'комиссия возврат wildberries' }),
    );
    expect(doublePenalty.score).toBeLessThan(singlePenalty.score);
  });

  it('no penalties for clean WB payout', () => {
    const r = scoreCandidate(wb, bankExact);
    expect(r.penalties).toHaveLength(0);
  });
});

// ── Reason codes ──────────────────────────────────────────────────────────────

describe('reason codes', () => {
  it('includes REFERENCE_MATCH when references match', () => {
    const r = scoreCandidate(
      makeTx({ reference: 'WB-001' }),
      makeTx({ reference: 'WB-001' }),
    );
    expect(r.reasonCodes).toContain('REFERENCE_MATCH');
  });

  it('includes DATE_OUT_OF_WINDOW for far dates', () => {
    const r = scoreCandidate(
      wb,
      makeTx({ transaction_date: new Date('2025-04-30T10:00:00Z') }),
      { ...DEFAULT_WEIGHTS, date_window_days: 7 },
    );
    expect(r.reasonCodes).toContain('DATE_OUT_OF_WINDOW');
  });
});

// ── Overall score bounds ──────────────────────────────────────────────────────

describe('overall score', () => {
  it('score is between 0 and 1', () => {
    const r = scoreCandidate(wb, bankExact);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it('perfect match scores near 1.0', () => {
    const r = scoreCandidate(
      makeTx({ reference: 'WB-001', description: 'выплата wildberries', counterparty: 'Wildberries' }),
      makeTx({ reference: 'WB-001', description: 'выплата wildberries', counterparty: 'Wildberries' }),
    );
    expect(r.score).toBeGreaterThan(0.9);
  });

  it('amount mismatch produces low score', () => {
    const r = scoreCandidate(
      wb,
      makeTx({ amount_kopeks: BigInt(99999) }),
    );
    expect(r.score).toBeLessThan(0.4);
  });
});
