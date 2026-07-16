import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleReconcile } from '@/src/lib/jobs/handlers/reconcile';
import type { Job } from '@/src/db/repositories/jobs';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/src/db/repositories/reconciliation-runs', () => ({
  findRunById: vi.fn(),
  updateRun: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/db/repositories/reconciliation-matches', () => ({
  findMatchesByRunId: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/db/repositories/reconciliation-match-items', () => ({
  findMatchItemsByMatchId: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/db/repositories/canonical-transactions', () => ({
  findTransactionsByImportId: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/db/repositories/users', () => ({
  findUserById: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/src/db/repositories/imports', () => ({
  findImportById: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/src/lib/reconciliation/candidates', () => ({
  generateCandidates: vi.fn().mockResolvedValue(0),
  updateCandidateScores: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/reconciliation/assignment', () => ({
  globalMatch: vi.fn().mockResolvedValue({ matchedCount: 0, unmatchedCount: 0, ambiguousCount: 0, splitCount: 0, combinedCount: 0, matchRate: 0, unmatchedAmount: BigInt(0), ambiguousAmount: BigInt(0) }),
}));
vi.mock('@/src/lib/reconciliation/splitCombined', () => ({
  detectSplitCombined: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/jobs/queue', () => ({
  enqueue: vi.fn().mockResolvedValue('job-1'),
}));

import { findRunById, updateRun } from '@/src/db/repositories/reconciliation-runs';
import { findMatchesByRunId } from '@/src/db/repositories/reconciliation-matches';
import { findMatchItemsByMatchId } from '@/src/db/repositories/reconciliation-match-items';
import { findTransactionsByImportId } from '@/src/db/repositories/canonical-transactions';
import { generateCandidates, updateCandidateScores } from '@/src/lib/reconciliation/candidates';
import { globalMatch } from '@/src/lib/reconciliation/assignment';
import { detectSplitCombined } from '@/src/lib/reconciliation/splitCombined';
import { enqueue } from '@/src/lib/jobs/queue';

const mockFindRunById = vi.mocked(findRunById);
const mockUpdateRun = vi.mocked(updateRun);
const mockFindMatches = vi.mocked(findMatchesByRunId);
const mockFindMatchItems = vi.mocked(findMatchItemsByMatchId);
const mockFindTxs = vi.mocked(findTransactionsByImportId);
const mockGenerateCandidates = vi.mocked(generateCandidates);
const mockUpdateCandidateScores = vi.mocked(updateCandidateScores);
const mockGlobalMatch = vi.mocked(globalMatch);
const mockDetectSplitCombined = vi.mocked(detectSplitCombined);
const mockEnqueue = vi.mocked(enqueue);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_RUN = {
  id: 'run-1',
  user_id: 'user-1',
  wb_import_id: 'wb-1',
  bank_import_id: 'bank-1',
  status: 'PENDING',
  total_wb_rows: 10,
  total_bank_rows: 15,
  started_at: null,
};

function makeJob(payload: Record<string, string> = {}): Job {
  return {
    id: 'job-1',
    job_type: 'reconcile',
    entity_id: 'run-1',
    payload,
    status: 'PENDING',
    retries: 0,
    correlation_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    started_at: null,
    completed_at: null,
    failure_reason: null,
  };
}

function makeTx(id: string, amount: number) {
  return {
    id,
    import_id: 'wb-1',
    amount_kopeks: BigInt(amount),
    transaction_date: new Date('2025-03-15'),
    direction: 'IN',
    source_type: 'WB',
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleReconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRunById.mockResolvedValue(FAKE_RUN as never);
    mockUpdateRun.mockResolvedValue(FAKE_RUN as never);
    mockFindMatches.mockResolvedValue([]);
    mockFindMatchItems.mockResolvedValue([]);
    mockFindTxs.mockResolvedValue([]);
    mockEnqueue.mockResolvedValue('job-2');
    mockGenerateCandidates.mockResolvedValue(0);
    mockUpdateCandidateScores.mockResolvedValue(undefined);
    mockGlobalMatch.mockResolvedValue({} as never);
    mockDetectSplitCombined.mockResolvedValue(undefined);
  });

  it('exits early when run is already COMPLETED', async () => {
    mockFindRunById.mockResolvedValue({ ...FAKE_RUN, status: 'COMPLETED' } as never);
    await handleReconcile(makeJob({ run_id: 'run-1' }));
    expect(mockGenerateCandidates).not.toHaveBeenCalled();
  });

  it('exits early when run is already FAILED', async () => {
    mockFindRunById.mockResolvedValue({ ...FAKE_RUN, status: 'FAILED' } as never);
    await handleReconcile(makeJob({ run_id: 'run-1' }));
    expect(mockGenerateCandidates).not.toHaveBeenCalled();
  });

  it('throws when run not found', async () => {
    mockFindRunById.mockResolvedValue(undefined);
    await expect(handleReconcile(makeJob({ run_id: 'run-1' }))).rejects.toThrow();
  });

  it('throws when run_id missing from payload and entity_id', async () => {
    const job = { ...makeJob(), entity_id: '', payload: {} };
    await expect(handleReconcile(job as Job)).rejects.toThrow();
  });

  it('calls all pipeline steps in order', async () => {
    const callOrder: string[] = [];
    mockGenerateCandidates.mockImplementation(async () => { callOrder.push('generate'); return 0; });
    mockUpdateCandidateScores.mockImplementation(async () => { callOrder.push('score'); });
    mockGlobalMatch.mockImplementation(async () => { callOrder.push('match'); return {} as never; });
    mockDetectSplitCombined.mockImplementation(async () => { callOrder.push('split'); });

    await handleReconcile(makeJob({ run_id: 'run-1' }));

    expect(callOrder).toEqual(['generate', 'score', 'match', 'split']);
  });

  it('updates run to RUNNING before processing', async () => {
    await handleReconcile(makeJob({ run_id: 'run-1' }));
    const firstUpdateCall = mockUpdateRun.mock.calls[0];
    expect(firstUpdateCall[1]).toMatchObject({ status: 'RUNNING' });
  });

  it('updates run to COMPLETED with correct metrics', async () => {
    // 2 WB transactions, 1 MATCHED
    mockFindTxs.mockResolvedValue([
      makeTx('tx-1', 150000),
      makeTx('tx-2', 250000),
    ] as never);
    mockFindMatches.mockResolvedValue([
      { id: 'm-1', match_type: 'MATCHED', run_id: 'run-1', final_score: '0.95' },
    ] as never);
    mockFindMatchItems.mockResolvedValue([
      { match_id: 'm-1', transaction_id: 'tx-1', side: 'WB' },
      { match_id: 'm-1', transaction_id: 'bank-tx-1', side: 'BANK' },
    ] as never);

    await handleReconcile(makeJob({ run_id: 'run-1' }));

    const completedCall = mockUpdateRun.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>).status === 'COMPLETED',
    );
    expect(completedCall).toBeDefined();
    expect(completedCall![1]).toMatchObject({
      status: 'COMPLETED',
      matched_count: 1,
      unmatched_count: 1,
    });
  });

  it('enqueues report_export job after completion', async () => {
    await handleReconcile(makeJob({ run_id: 'run-1' }));
    expect(mockEnqueue).toHaveBeenCalledWith('report_export', 'run-1', { run_id: 'run-1' });
  });

  it('sets run to FAILED and re-throws when a pipeline step throws', async () => {
    mockGenerateCandidates.mockRejectedValue(new Error('DB error'));
    await expect(handleReconcile(makeJob({ run_id: 'run-1' }))).rejects.toThrow('DB error');

    const failedCall = mockUpdateRun.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>).status === 'FAILED',
    );
    expect(failedCall).toBeDefined();
    expect(failedCall![1]).toMatchObject({
      status: 'FAILED',
      failure_reason: 'DB error',
    });
  });

  it('counts SPLIT_MATCHED and COMBINED_MATCHED as part of matchedCount', async () => {
    mockFindTxs.mockResolvedValue([
      makeTx('wb-1', 100000),
      makeTx('wb-2', 50000),
      makeTx('wb-3', 50000),
    ] as never);
    mockFindMatches.mockResolvedValue([
      { id: 'm-split', match_type: 'SPLIT_MATCHED', run_id: 'run-1' },
      { id: 'm-comb', match_type: 'COMBINED_MATCHED', run_id: 'run-1' },
    ] as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockFindMatchItems.mockImplementation(async (matchId: string): Promise<any> => {
      if (matchId === 'm-split') {
        return [
          { match_id: 'm-split', transaction_id: 'wb-1', side: 'WB' },
        ];
      }
      return [
        { match_id: 'm-comb', transaction_id: 'wb-2', side: 'WB' },
        { match_id: 'm-comb', transaction_id: 'wb-3', side: 'WB' },
      ];
    });

    await handleReconcile(makeJob({ run_id: 'run-1' }));

    const completedCall = mockUpdateRun.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>).status === 'COMPLETED',
    );
    expect(completedCall![1]).toMatchObject({
      matched_count: 2, // 1 SPLIT + 1 COMBINED
      split_count: 1,
      combined_count: 1,
      unmatched_count: 0,
    });
  });

  it('uses entity_id as fallback run_id when payload is empty', async () => {
    await handleReconcile(makeJob());
    expect(mockFindRunById).toHaveBeenCalledWith('run-1');
  });
});
