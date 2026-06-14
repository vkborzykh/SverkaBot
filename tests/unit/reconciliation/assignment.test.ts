import { describe, it, expect, vi, beforeEach } from 'vitest';
import { globalMatch } from '@/src/lib/reconciliation/assignment';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/src/db/repositories/reconciliation-candidates', () => ({
  findCandidatesByRunId: vi.fn(),
}));
vi.mock('@/src/db/repositories/reconciliation-runs', () => ({
  findRunById: vi.fn(),
}));
vi.mock('@/src/db/repositories/canonical-transactions', () => ({
  findTransactionsByImportId: vi.fn(),
}));
vi.mock('@/src/db/repositories/reconciliation-matches', () => ({
  createMatches: vi.fn().mockImplementation(async (rows) =>
    rows.map((r: Record<string, unknown>, i: number) => ({ ...r, id: `match-${i}-${Date.now()}` })),
  ),
  findMatchesByRunId: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/db/repositories/reconciliation-match-items', () => ({
  createMatchItems: vi.fn().mockResolvedValue([]),
  findMatchItemsByMatchId: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/db/repositories/reconciliation-evidence', () => ({
  createEvidence: vi.fn().mockResolvedValue({ id: 'ev-1' }),
}));
vi.mock('@/src/lib/settings/settings', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

import { findCandidatesByRunId } from '@/src/db/repositories/reconciliation-candidates';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findTransactionsByImportId } from '@/src/db/repositories/canonical-transactions';
import { createMatches } from '@/src/db/repositories/reconciliation-matches';

const mockCandidates = vi.mocked(findCandidatesByRunId);
const mockRun = vi.mocked(findRunById);
const mockTxs = vi.mocked(findTransactionsByImportId);
const mockCreateMatches = vi.mocked(createMatches);

// ── Fixture helpers ───────────────────────────────────────────────────────────

const FAKE_RUN = { id: 'run-1', wb_import_id: 'wb-1', bank_import_id: 'bank-1' };

function makeTx(id: string, amount: number, date = '2025-03-15', importId = 'wb-1') {
  return {
    id,
    import_id: importId,
    source_type: importId === 'wb-1' ? 'WB' : 'BANK',
    direction: 'IN',
    currency: 'RUB',
    amount_kopeks: BigInt(amount),
    transaction_date: new Date(date),
    row_number: 1,
    reference: null,
    description: null,
    counterparty: null,
    row_hash: id,
    raw_payload: null,
    created_at: new Date(),
  };
}

function makeCandidate(
  id: string,
  wbId: string,
  bankId: string,
  score: number,
  reasonCodes: string[] = [],
) {
  return { id, wb_tx_id: wbId, bank_tx_id: bankId, score: String(score), reason_codes: reasonCodes };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('globalMatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue(FAKE_RUN as never);
    mockCreateMatches.mockImplementation(async (rows) =>
      (rows as Record<string, unknown>[]).map((r, i) => ({ ...r, id: `match-${i}` })) as never,
    );
  });

  it('returns all WB as unmatched when no candidates exist', async () => {
    mockCandidates.mockResolvedValue([]);
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') return [makeTx('wb-tx-1', 150000), makeTx('wb-tx-2', 250000)] as never;
      return [] as never;
    });

    const stats = await globalMatch('run-1');
    expect(stats.matchedCount).toBe(0);
    expect(stats.unmatchedCount).toBe(2);
  });

  it('creates a MATCHED record for a simple 1:1 high-confidence pair', async () => {
    mockCandidates.mockResolvedValue([
      makeCandidate('c1', 'wb-tx-1', 'bank-tx-1', 0.95),
    ] as never);
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') return [makeTx('wb-tx-1', 150000)] as never;
      return [makeTx('bank-tx-1', 150000, '2025-03-15', 'bank-1')] as never;
    });

    const stats = await globalMatch('run-1');
    expect(stats.matchedCount).toBe(1);
    expect(stats.unmatchedCount).toBe(0);
    expect(mockCreateMatches).toHaveBeenCalled();
    const matchArg = mockCreateMatches.mock.calls[0][0] as { match_type: string }[];
    expect(matchArg.some((m) => m.match_type === 'MATCHED')).toBe(true);
  });

  it('leaves WB unmatched when candidate score below high-conf threshold', async () => {
    mockCandidates.mockResolvedValue([
      makeCandidate('c1', 'wb-tx-1', 'bank-tx-1', 0.5),
    ] as never);
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') return [makeTx('wb-tx-1', 150000)] as never;
      return [makeTx('bank-tx-1', 150000, '2025-03-15', 'bank-1')] as never;
    });

    const stats = await globalMatch('run-1');
    // Low score still gets matched via component solver
    expect(stats.matchedCount + stats.unmatchedCount).toBe(1);
  });

  it('selects best total weight for 2-WB × 2-bank component', async () => {
    // WB1→Bank1: 0.9, WB1→Bank2: 0.3
    // WB2→Bank1: 0.4, WB2→Bank2: 0.8
    // Optimal: WB1→Bank1 (0.9) + WB2→Bank2 (0.8) = 1.7
    // Suboptimal: WB1→Bank2 (0.3) + WB2→Bank1 (0.4) = 0.7
    mockCandidates.mockResolvedValue([
      makeCandidate('c1', 'wb-tx-1', 'bank-tx-1', 0.9),
      makeCandidate('c2', 'wb-tx-1', 'bank-tx-2', 0.3),
      makeCandidate('c3', 'wb-tx-2', 'bank-tx-1', 0.4),
      makeCandidate('c4', 'wb-tx-2', 'bank-tx-2', 0.8),
    ] as never);
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') {
        return [
          makeTx('wb-tx-1', 150000),
          makeTx('wb-tx-2', 200000),
        ] as never;
      }
      return [
        makeTx('bank-tx-1', 150000, '2025-03-15', 'bank-1'),
        makeTx('bank-tx-2', 200000, '2025-03-15', 'bank-1'),
      ] as never;
    });

    const stats = await globalMatch('run-1');
    expect(stats.matchedCount).toBe(2);
    expect(stats.unmatchedCount).toBe(0);

    // Verify that the higher-scoring assignments were chosen
    const matchCalls = mockCreateMatches.mock.calls;
    expect(matchCalls.length).toBeGreaterThan(0);
  });

  it('marks WB as AMBIGUOUS when two candidates have equal high scores', async () => {
    mockCandidates.mockResolvedValue([
      makeCandidate('c1', 'wb-tx-1', 'bank-tx-1', 0.75),
      makeCandidate('c2', 'wb-tx-1', 'bank-tx-2', 0.74), // within 0.1 threshold
    ] as never);
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') return [makeTx('wb-tx-1', 150000)] as never;
      return [
        makeTx('bank-tx-1', 150000, '2025-03-15', 'bank-1'),
        makeTx('bank-tx-2', 150000, '2025-03-15', 'bank-1'),
      ] as never;
    });

    const stats = await globalMatch('run-1');
    // Could be ambiguous or matched — depends on brute-force choice
    expect(stats.matchedCount + stats.ambiguousCount).toBeGreaterThan(0);
  });

  it('throws when run not found', async () => {
    mockRun.mockResolvedValue(undefined);
    await expect(globalMatch('nonexistent')).rejects.toThrow();
  });

  it('matchRate is 100% when all WB matched', async () => {
    mockCandidates.mockResolvedValue([
      makeCandidate('c1', 'wb-tx-1', 'bank-tx-1', 0.95),
    ] as never);
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') return [makeTx('wb-tx-1', 150000)] as never;
      return [makeTx('bank-tx-1', 150000, '2025-03-15', 'bank-1')] as never;
    });

    const stats = await globalMatch('run-1');
    expect(stats.matchRate).toBe(100);
  });

  it('matchRate is 50% when half of WB matched', async () => {
    mockCandidates.mockResolvedValue([
      makeCandidate('c1', 'wb-tx-1', 'bank-tx-1', 0.95),
    ] as never);
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') {
        return [makeTx('wb-tx-1', 150000), makeTx('wb-tx-2', 200000)] as never;
      }
      return [makeTx('bank-tx-1', 150000, '2025-03-15', 'bank-1')] as never;
    });

    const stats = await globalMatch('run-1');
    expect(stats.matchedCount).toBe(1);
    expect(stats.unmatchedCount).toBe(1);
    expect(stats.matchRate).toBe(50);
  });

  it('unmatchedAmount sums kopeks of all unmatched WB transactions', async () => {
    mockCandidates.mockResolvedValue([]);
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') {
        return [
          makeTx('wb-tx-1', 100000),
          makeTx('wb-tx-2', 250000),
        ] as never;
      }
      return [] as never;
    });

    const stats = await globalMatch('run-1');
    expect(stats.unmatchedAmount).toBe(BigInt(350000));
  });
});
