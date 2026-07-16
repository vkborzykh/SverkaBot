import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeEvidence } from '@/src/lib/reconciliation/evidence';

vi.mock('@/src/db/repositories/reconciliation-evidence', () => ({
  createEvidence: vi.fn().mockResolvedValue({ id: 'ev-1', match_id: 'match-1' }),
}));

import { createEvidence } from '@/src/db/repositories/reconciliation-evidence';

const mockCreateEvidence = vi.mocked(createEvidence);

describe('storeEvidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateEvidence.mockResolvedValue({ id: 'ev-1' } as never);
  });

  it('calls createEvidence with all component scores', async () => {
    await storeEvidence({
      matchId: 'match-1',
      components: {
        amount_score: 1.0,
        date_score: 0.857,
        reference_score: 0.5,
        description_score: 1.0,
        counterparty_score: 0.0,
      },
      penalties: [],
      finalScore: 0.875,
    });

    expect(mockCreateEvidence).toHaveBeenCalledOnce();
    const arg = mockCreateEvidence.mock.calls[0][0];
    expect(arg.match_id).toBe('match-1');
    expect(arg.amount_score).toBe('1.0000');
    expect(arg.date_score).toBe('0.8570');
    expect(arg.reference_score).toBe('0.5000');
    expect(arg.description_score).toBe('1.0000');
    expect(arg.counterparty_score).toBe('0.0000');
  });

  it('stores penalties array in the evidence record', async () => {
    await storeEvidence({
      matchId: 'match-2',
      components: {
        amount_score: 1.0,
        date_score: 0.5,
        reference_score: 0.0,
        description_score: 0.5,
        counterparty_score: 0.0,
      },
      penalties: ['FEE', 'REFUND'],
      finalScore: 0.4,
    });

    const arg = mockCreateEvidence.mock.calls[0][0];
    expect(arg.penalties).toEqual(['FEE', 'REFUND']);
  });

  it('stores empty penalties array when no penalties', async () => {
    await storeEvidence({
      matchId: 'match-3',
      components: {
        amount_score: 1.0,
        date_score: 1.0,
        reference_score: 1.0,
        description_score: 1.0,
        counterparty_score: 1.0,
      },
      penalties: [],
      finalScore: 1.0,
    });

    const arg = mockCreateEvidence.mock.calls[0][0];
    expect(arg.penalties).toEqual([]);
  });

  it('rounds component scores to 4 decimal places', async () => {
    await storeEvidence({
      matchId: 'match-4',
      components: {
        amount_score: 1,
        date_score: 0.8571428571,
        reference_score: 0.333333333,
        description_score: 0.666666667,
        counterparty_score: 0.0,
      },
      penalties: [],
      finalScore: 0.7,
    });

    const arg = mockCreateEvidence.mock.calls[0][0];
    expect(arg.date_score).toBe('0.8571');
    expect(arg.reference_score).toBe('0.3333');
    expect(arg.description_score).toBe('0.6667');
  });

  it('handles missing component keys gracefully (defaults to 0)', async () => {
    await storeEvidence({
      matchId: 'match-5',
      components: {},
      penalties: [],
      finalScore: 0.0,
    });

    const arg = mockCreateEvidence.mock.calls[0][0];
    expect(arg.amount_score).toBe('0.0000');
    expect(arg.date_score).toBe('0.0000');
  });
});
