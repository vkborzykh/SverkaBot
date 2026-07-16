import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectSplitCombined } from '@/src/lib/reconciliation/splitCombined';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/src/db/repositories/reconciliation-runs', () => ({
  findRunById: vi.fn(),
}));
vi.mock('@/src/db/repositories/canonical-transactions', () => ({
  findTransactionsByImportId: vi.fn(),
}));
vi.mock('@/src/db/repositories/reconciliation-matches', () => ({
  findMatchesByRunId: vi.fn().mockResolvedValue([]),
  createMatches: vi.fn().mockImplementation(async (rows) =>
    (rows as Record<string, unknown>[]).map((r, i) => ({ ...r, id: `sc-match-${i}` })),
  ),
}));
vi.mock('@/src/db/repositories/reconciliation-match-items', () => ({
  findMatchItemsByMatchId: vi.fn().mockResolvedValue([]),
  createMatchItems: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/lib/settings/settings', () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/src/db/index', () => ({
  getDb: vi.fn().mockReturnValue({
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  }),
}));
vi.mock('@/src/db/schema', () => ({
  reconciliation_matches: {},
}));

import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findTransactionsByImportId } from '@/src/db/repositories/canonical-transactions';
import { createMatches } from '@/src/db/repositories/reconciliation-matches';
import { createMatchItems } from '@/src/db/repositories/reconciliation-match-items';

const mockRun = vi.mocked(findRunById);
const mockTxs = vi.mocked(findTransactionsByImportId);
const mockCreateMatches = vi.mocked(createMatches);
const mockCreateMatchItems = vi.mocked(createMatchItems);

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_RUN = { id: 'run-1', wb_import_id: 'wb-1', bank_import_id: 'bank-1' };
const BASE_DATE = new Date('2025-03-15');

function makeTx(id: string, amount: number, importId: string, daysOffset = 0) {
  const d = new Date(BASE_DATE);
  d.setDate(d.getDate() + daysOffset);
  return {
    id,
    import_id: importId,
    amount_kopeks: BigInt(amount),
    transaction_date: d,
    direction: 'IN',
    source_type: importId === 'wb-1' ? 'WB' : 'BANK',
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('detectSplitCombined – SPLIT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue(FAKE_RUN as never);
    mockCreateMatches.mockImplementation(async (rows) =>
      (rows as Record<string, unknown>[]).map((r, i) => ({ ...r, id: `m-${i}` })) as never,
    );
    mockCreateMatchItems.mockResolvedValue([]);
  });

  it('creates SPLIT_MATCHED for 1 WB (1000) → 2 bank (300+700)', async () => {
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') return [makeTx('wb-1', 100000, 'wb-1')] as never;
      return [
        makeTx('b-1', 30000, 'bank-1'),
        makeTx('b-2', 70000, 'bank-1'),
      ] as never;
    });

    await detectSplitCombined('run-1');

    expect(mockCreateMatches).toHaveBeenCalled();
    const matchArg = mockCreateMatches.mock.calls[0][0] as { match_type: string }[];
    expect(matchArg[0].match_type).toBe('SPLIT_MATCHED');
  });

  it('creates SPLIT_MATCHED for 1 WB (1000) → 3 bank (300+300+400)', async () => {
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') return [makeTx('wb-1', 100000, 'wb-1')] as never;
      return [
        makeTx('b-1', 30000, 'bank-1'),
        makeTx('b-2', 30000, 'bank-1'),
        makeTx('b-3', 40000, 'bank-1'),
      ] as never;
    });

    await detectSplitCombined('run-1');

    expect(mockCreateMatches).toHaveBeenCalled();
    const matchArg = mockCreateMatches.mock.calls[0][0] as { match_type: string }[];
    expect(matchArg[0].match_type).toBe('SPLIT_MATCHED');

    const items = mockCreateMatchItems.mock.calls[0][0] as { side: string }[];
    expect(items.filter((i) => i.side === 'WB')).toHaveLength(1);
    expect(items.filter((i) => i.side === 'BANK')).toHaveLength(3);
  });

  it('does not create SPLIT when sums do not match', async () => {
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') return [makeTx('wb-1', 100000, 'wb-1')] as never;
      return [
        makeTx('b-1', 30000, 'bank-1'),
        makeTx('b-2', 50000, 'bank-1'), // 30000+50000 ≠ 100000
      ] as never;
    });

    await detectSplitCombined('run-1');

    expect(mockCreateMatches).not.toHaveBeenCalled();
  });

  it('does not create SPLIT when bank tx is outside date window', async () => {
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') return [makeTx('wb-1', 100000, 'wb-1')] as never;
      return [
        makeTx('b-1', 30000, 'bank-1', 0),
        makeTx('b-2', 70000, 'bank-1', 10), // 10 days away, window=7
      ] as never;
    });

    await detectSplitCombined('run-1');

    expect(mockCreateMatches).not.toHaveBeenCalled();
  });
});

describe('detectSplitCombined – COMBINED', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue(FAKE_RUN as never);
    mockCreateMatches.mockImplementation(async (rows) =>
      (rows as Record<string, unknown>[]).map((r, i) => ({ ...r, id: `m-${i}` })) as never,
    );
    mockCreateMatchItems.mockResolvedValue([]);
  });

  it('creates COMBINED_MATCHED for 2 WB (500+500) → 1 bank (1000)', async () => {
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') {
        return [
          makeTx('wb-1', 50000, 'wb-1'),
          makeTx('wb-2', 50000, 'wb-1'),
        ] as never;
      }
      return [makeTx('b-1', 100000, 'bank-1')] as never;
    });

    await detectSplitCombined('run-1');

    expect(mockCreateMatches).toHaveBeenCalled();
    const matchArg = mockCreateMatches.mock.calls[0][0] as { match_type: string }[];
    expect(matchArg[0].match_type).toBe('COMBINED_MATCHED');

    const items = mockCreateMatchItems.mock.calls[0][0] as { side: string }[];
    expect(items.filter((i) => i.side === 'WB')).toHaveLength(2);
    expect(items.filter((i) => i.side === 'BANK')).toHaveLength(1);
  });

  it('creates COMBINED_MATCHED for 3 WB (200+300+500) → 1 bank (1000)', async () => {
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') {
        return [
          makeTx('wb-1', 20000, 'wb-1'),
          makeTx('wb-2', 30000, 'wb-1'),
          makeTx('wb-3', 50000, 'wb-1'),
        ] as never;
      }
      return [makeTx('b-1', 100000, 'bank-1')] as never;
    });

    await detectSplitCombined('run-1');

    expect(mockCreateMatches).toHaveBeenCalled();
    const matchArg = mockCreateMatches.mock.calls[0][0] as { match_type: string }[];
    expect(matchArg[0].match_type).toBe('COMBINED_MATCHED');
  });

  it('does not create COMBINED when sums do not match', async () => {
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') {
        return [
          makeTx('wb-1', 50000, 'wb-1'),
          makeTx('wb-2', 40000, 'wb-1'), // 50000+40000 ≠ 100000
        ] as never;
      }
      return [makeTx('b-1', 100000, 'bank-1')] as never;
    });

    await detectSplitCombined('run-1');

    expect(mockCreateMatches).not.toHaveBeenCalled();
  });

  it('does not create COMBINED when WB tx is outside date window', async () => {
    mockTxs.mockImplementation(async (id) => {
      if (id === 'wb-1') {
        return [
          makeTx('wb-1', 50000, 'wb-1', 0),
          makeTx('wb-2', 50000, 'wb-1', 10), // outside window
        ] as never;
      }
      return [makeTx('b-1', 100000, 'bank-1')] as never;
    });

    await detectSplitCombined('run-1');

    expect(mockCreateMatches).not.toHaveBeenCalled();
  });
});

describe('detectSplitCombined – no-ops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue(FAKE_RUN as never);
    mockCreateMatches.mockResolvedValue([{ id: 'm-1' }] as never);
    mockCreateMatchItems.mockResolvedValue([]);
  });

  it('does nothing when there are no transactions', async () => {
    mockTxs.mockResolvedValue([] as never);
    await detectSplitCombined('run-1');
    expect(mockCreateMatches).not.toHaveBeenCalled();
  });

  it('throws when run not found', async () => {
    mockRun.mockResolvedValue(undefined);
    await expect(detectSplitCombined('run-1')).rejects.toThrow();
  });
});
