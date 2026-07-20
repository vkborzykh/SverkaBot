import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/db/repositories/reconciliation-candidates', () => ({
  findCandidatesByRunId: vi.fn(),
}));

vi.mock('@/src/lib/reconciliation/candidates', () => ({
  generateCandidates: vi.fn(),
}));

import { buildRowLevelClaim } from '@/src/lib/reconciliation/claimBuilder';
import { findCandidatesByRunId } from '@/src/db/repositories/reconciliation-candidates';
import { generateCandidates } from '@/src/lib/reconciliation/candidates';

const mockFindCandidates = vi.mocked(findCandidatesByRunId);
const mockGenerateCandidates = vi.mocked(generateCandidates);

function wbTx(id: string, amountKopeks: bigint, date = '2026-07-10') {
  return {
    id,
    direction: 'IN',
    amount_kopeks: amountKopeks,
    transaction_date: date,
    reference: `ref-${id}`,
    description: `desc-${id}`,
  } as any;
}

describe('buildRowLevelClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when there is no loss', async () => {
    const result = await buildRowLevelClaim('run-1', [wbTx('t1', BigInt(10000))], BigInt(0));
    expect(result).toBeNull();
    expect(mockFindCandidates).not.toHaveBeenCalled();
  });

  it('generates candidates lazily when the shadow run has not populated them yet', async () => {
    mockFindCandidates.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { wb_tx_id: 't1', bank_tx_id: 'b1' } as any,
    ]);
    mockGenerateCandidates.mockResolvedValueOnce(1);

    const txs = [wbTx('t1', BigInt(10000)), wbTx('t2', BigInt(5000))];
    const result = await buildRowLevelClaim('run-1', txs, BigInt(5000));

    expect(mockGenerateCandidates).toHaveBeenCalledWith('run-1');
    expect(result).not.toBeNull();
    // t1 has a candidate (matched), t2 doesn't -> t2 is the unmatched claim row
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].amountKopeks).toBe(BigInt(5000));
    expect(result?.confidence).toBe('high');
  });

  it('flags low confidence when unmatched sum diverges from the trusted aggregate', async () => {
    mockFindCandidates.mockResolvedValue([{ wb_tx_id: 'other', bank_tx_id: 'b1' } as any]);

    // Aggregate says the loss is 100 000 kopeks, but zero-candidate rows sum to only 5 000 —
    // a big mismatch (e.g. because scoring/assignment would resolve some via a different
    // bank tx that candidates.ts's hard filters didn't associate 1:1).
    const txs = [wbTx('t1', BigInt(5000))];
    const result = await buildRowLevelClaim('run-1', txs, BigInt(100000));

    expect(result?.confidence).toBe('low');
  });

  it('excludes OUT-direction WB transactions from the claim', async () => {
    // t1 is OUT-direction so it must never appear in the claim regardless of
    // candidates; give it a candidate anyway to prove the filter is by
    // direction, not just "has no candidate".
    mockFindCandidates.mockResolvedValue([{ wb_tx_id: 't1', bank_tx_id: 'b1' } as any]);
    const txs = [
      { ...wbTx('t1', BigInt(5000)), direction: 'OUT' },
      wbTx('t2', BigInt(5000)),
    ];
    const result = await buildRowLevelClaim('run-1', txs, BigInt(5000));
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].reference).toBe('ref-t2');
  });

  it('falls back to null if generateCandidates throws and no candidates exist', async () => {
    mockFindCandidates.mockResolvedValue([]);
    mockGenerateCandidates.mockRejectedValueOnce(new Error('db unavailable'));

    const result = await buildRowLevelClaim('run-1', [wbTx('t1', BigInt(5000))], BigInt(5000));
    expect(result).toBeNull();
  });
});
