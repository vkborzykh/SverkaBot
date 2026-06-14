import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCandidates } from '@/src/lib/reconciliation/candidates';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/src/db/repositories/reconciliation-runs', () => ({
  findRunById: vi.fn(),
}));

vi.mock('@/src/db/repositories/canonical-transactions', () => ({
  findTransactionsByImportId: vi.fn(),
}));

vi.mock('@/src/db/repositories/reconciliation-candidates', () => ({
  createCandidates: vi.fn().mockResolvedValue([]),
  findCandidatesByRunId: vi.fn(),
  updateCandidateScore: vi.fn(),
}));

vi.mock('@/src/lib/settings/settings', () => ({
  getSetting: vi.fn().mockResolvedValue(null), // forces default values
}));

import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findTransactionsByImportId } from '@/src/db/repositories/canonical-transactions';
import { createCandidates } from '@/src/db/repositories/reconciliation-candidates';

const mockFindRunById = vi.mocked(findRunById);
const mockFindTxsByImportId = vi.mocked(findTransactionsByImportId);
const mockCreateCandidates = vi.mocked(createCandidates);

// ── Fixture builders ──────────────────────────────────────────────────────────

const FAKE_RUN = {
  id: 'run-1',
  wb_import_id: 'wb-import-1',
  bank_import_id: 'bank-import-1',
};

type Tx = {
  id: string;
  import_id: string;
  source_type: string;
  direction: 'IN' | 'OUT';
  currency: string;
  amount_kopeks: bigint;
  transaction_date: Date;
  row_number: number;
  reference: string | null;
  description: string | null;
  counterparty: string | null;
  row_hash: string;
  raw_payload: unknown;
  created_at: Date;
};

function makeTx(overrides: Partial<Tx>): Tx {
  return {
    id: 'tx-' + Math.random().toString(36).slice(2),
    import_id: 'import-1',
    source_type: 'WB',
    direction: 'IN',
    currency: 'RUB',
    amount_kopeks: BigInt(150000),
    transaction_date: new Date('2025-03-15T10:00:00Z'),
    row_number: 1,
    reference: null,
    description: null,
    counterparty: null,
    row_hash: 'abc',
    raw_payload: null,
    created_at: new Date(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRunById.mockResolvedValue(FAKE_RUN as never);
    mockCreateCandidates.mockResolvedValue([]);
  });

  it('generates one candidate for exact match (same amount, same date, IN/IN, RUB)', async () => {
    const wb = makeTx({ id: 'wb-1', source_type: 'WB', import_id: 'wb-import-1' });
    const bank = makeTx({ id: 'bank-1', source_type: 'BANK', import_id: 'bank-import-1' });

    mockFindTxsByImportId.mockImplementation(async (importId) => {
      if (importId === 'wb-import-1') return [wb] as never;
      return [bank] as never;
    });

    const count = await generateCandidates('run-1');
    expect(count).toBe(1);
    expect(mockCreateCandidates).toHaveBeenCalledOnce();
  });

  it('generates zero candidates when amounts differ', async () => {
    const wb = makeTx({ id: 'wb-1', amount_kopeks: BigInt(100000) });
    const bank = makeTx({ id: 'bank-1', amount_kopeks: BigInt(200000) });

    mockFindTxsByImportId.mockImplementation(async (importId) => {
      if (importId === 'wb-import-1') return [wb] as never;
      return [bank] as never;
    });

    const count = await generateCandidates('run-1');
    expect(count).toBe(0);
    expect(mockCreateCandidates).not.toHaveBeenCalled();
  });

  it('skips bank transactions with direction OUT', async () => {
    const wb = makeTx({ id: 'wb-1' });
    const bank = makeTx({ id: 'bank-1', direction: 'OUT' });

    mockFindTxsByImportId.mockImplementation(async (importId) => {
      if (importId === 'wb-import-1') return [wb] as never;
      return [bank] as never;
    });

    const count = await generateCandidates('run-1');
    expect(count).toBe(0);
  });

  it('skips bank transactions with non-RUB currency', async () => {
    const wb = makeTx({ id: 'wb-1' });
    const bank = makeTx({ id: 'bank-1', currency: 'USD' });

    mockFindTxsByImportId.mockImplementation(async (importId) => {
      if (importId === 'wb-import-1') return [wb] as never;
      return [bank] as never;
    });

    const count = await generateCandidates('run-1');
    expect(count).toBe(0);
  });

  it('skips pairs with date difference > 7 days (default window)', async () => {
    const wb = makeTx({ id: 'wb-1', transaction_date: new Date('2025-03-01T10:00:00Z') });
    const bank = makeTx({ id: 'bank-1', transaction_date: new Date('2025-03-15T10:00:00Z') });

    mockFindTxsByImportId.mockImplementation(async (importId) => {
      if (importId === 'wb-import-1') return [wb] as never;
      return [bank] as never;
    });

    const count = await generateCandidates('run-1');
    expect(count).toBe(0);
  });

  it('includes pairs within date window (e.g., 3 days apart)', async () => {
    const wb = makeTx({ id: 'wb-1', transaction_date: new Date('2025-03-15T10:00:00Z') });
    const bank = makeTx({ id: 'bank-1', transaction_date: new Date('2025-03-17T10:00:00Z') });

    mockFindTxsByImportId.mockImplementation(async (importId) => {
      if (importId === 'wb-import-1') return [wb] as never;
      return [bank] as never;
    });

    const count = await generateCandidates('run-1');
    expect(count).toBe(1);
  });

  it('generates multiple candidates: 3 WB × 2 matching bank rows', async () => {
    const wbTxs = [
      makeTx({ id: 'wb-1' }),
      makeTx({ id: 'wb-2' }),
      makeTx({ id: 'wb-3' }),
    ];
    const bankTxs = [
      makeTx({ id: 'bank-1', source_type: 'BANK' }),
      makeTx({ id: 'bank-2', source_type: 'BANK' }),
      makeTx({ id: 'bank-3', source_type: 'BANK', amount_kopeks: BigInt(999) }), // different amount
    ];

    mockFindTxsByImportId.mockImplementation(async (importId) => {
      if (importId === 'wb-import-1') return wbTxs as never;
      return bankTxs as never;
    });

    const count = await generateCandidates('run-1');
    // 3 WB × 2 matching bank = 6 candidates
    expect(count).toBe(6);
  });

  it('batches large candidate sets in chunks of 500', async () => {
    // Create 10 WB txs and 60 bank txs with same amount → 600 candidates
    const wbTxs = Array.from({ length: 10 }, (_, i) =>
      makeTx({ id: `wb-${i}` }),
    );
    const bankTxs = Array.from({ length: 60 }, (_, i) =>
      makeTx({ id: `bank-${i}`, source_type: 'BANK' }),
    );

    mockFindTxsByImportId.mockImplementation(async (importId) => {
      if (importId === 'wb-import-1') return wbTxs as never;
      return bankTxs as never;
    });

    const count = await generateCandidates('run-1');
    expect(count).toBe(600);
    // Should be called twice: chunk 0-499, chunk 500-600
    expect(mockCreateCandidates).toHaveBeenCalledTimes(2);
  });

  it('throws when run not found', async () => {
    mockFindRunById.mockResolvedValue(undefined);
    await expect(generateCandidates('nonexistent')).rejects.toThrow();
  });
});
