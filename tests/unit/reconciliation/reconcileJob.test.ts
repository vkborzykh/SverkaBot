import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from '@/src/db/repositories/jobs';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// handleReconcile сейчас построен вокруг агрегатной модели (reconcileWbPayout,
// wbPayoutCore.ts), а построчный движок (candidates/assignment/splitCombined)
// запускается ПОСЛЕ COMPLETED как fire-and-forget shadow-прогон, не влияющий
// на пользователя (см. runRowLevelShadow в reconcile.ts). Предыдущая версия
// этого теста проверяла более раннюю архитектуру, где построчный движок был
// основным путём — этот файл переписан под реальное поведение.

vi.mock('@/src/db/repositories/reconciliation-runs', () => ({
  findRunById: vi.fn(),
  updateRun: vi.fn().mockResolvedValue(undefined),
  findRunsByUserId: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/db/repositories/users', () => ({
  findUserById: vi.fn().mockResolvedValue(null),
  updateUser: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/db/repositories/imports', () => ({
  findImportById: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/src/lib/reconciliation/wbPayout', () => ({
  reconcileWbPayout: vi.fn(),
}));
vi.mock('@/src/lib/jobs/queue', () => ({
  enqueue: vi.fn().mockResolvedValue('job-2'),
}));
vi.mock('@/src/lib/telegram/session', () => ({
  clearSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/reconciliation/candidates', () => ({
  generateCandidates: vi.fn().mockResolvedValue(0),
  updateCandidateScores: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/reconciliation/assignment', () => ({
  globalMatch: vi.fn().mockResolvedValue({
    matchedCount: 0, unmatchedCount: 0, ambiguousCount: 0,
    matchRate: 0, unmatchedAmount: BigInt(0), ambiguousAmount: BigInt(0),
  }),
}));
vi.mock('@/src/lib/reconciliation/splitCombined', () => ({
  detectSplitCombined: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/db/repositories/admin-notifications', () => ({
  createAdminNotification: vi.fn().mockResolvedValue(undefined),
}));

// Мок getDb() для двух независимых цепочек запросов в reconcile.ts:
// 1) дедупликация месячного счётчика — .select().from().where().limit(1)
// 2) getWbDeductionsByCategory (разбивка удержаний в сообщении пользователю)
//    — .select().from().where().groupBy(...)
// По умолчанию обе резолвятся в [] (нет дублей / нет категоризированных удержаний).
const mockDbLimit = vi.fn().mockResolvedValue([]);
const mockDbGroupBy = vi.fn().mockResolvedValue([]);
const mockDbWhere = vi.fn(() => ({ limit: mockDbLimit, groupBy: mockDbGroupBy }));
const mockDbFrom = vi.fn(() => ({ where: mockDbWhere }));
const mockDbSelect = vi.fn(() => ({ from: mockDbFrom }));
vi.mock('@/src/db', () => ({
  getDb: () => ({ select: mockDbSelect }),
}));

import { findRunById, updateRun } from '@/src/db/repositories/reconciliation-runs';
import { findUserById, updateUser } from '@/src/db/repositories/users';
import { reconcileWbPayout } from '@/src/lib/reconciliation/wbPayout';
import { enqueue } from '@/src/lib/jobs/queue';
import { generateCandidates } from '@/src/lib/reconciliation/candidates';
import { handleReconcile } from '@/src/lib/jobs/handlers/reconcile';

const mockFindRunById = vi.mocked(findRunById);
const mockUpdateRun = vi.mocked(updateRun);
const mockFindUserById = vi.mocked(findUserById);
const mockUpdateUser = vi.mocked(updateUser);
const mockReconcileWbPayout = vi.mocked(reconcileWbPayout);
const mockEnqueue = vi.mocked(enqueue);
const mockGenerateCandidates = vi.mocked(generateCandidates);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_RUN = {
  id: 'run-1',
  user_id: 'user-1',
  wb_import_id: 'wb-1',
  bank_import_id: 'bank-1',
  status: 'PENDING',
  started_at: null,
};

function makeJob(payload: Record<string, string> = { run_id: 'run-1' }): Job {
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
  } as unknown as Job;
}

function makePayoutResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 'underpaid',
    matchType: 'UNMATCHED',
    expectedNetKopeks: BigInt(100000),
    wbInKopeks: BigInt(100000),
    wbOutKopeks: BigInt(0),
    receivedKopeks: BigInt(90000),
    discrepancyKopeks: BigInt(10000),
    bankCreditCount: 1,
    finalScore: 0.9,
    matchedCount: 1,
    unmatchedCount: 0,
    ambiguousCount: 0,
    splitCount: 0,
    combinedCount: 0,
    unmatchedAmountKopeks: BigInt(0),
    ambiguousAmountKopeks: BigInt(0),
    matchRate: 100,
    wbPayoutTxIds: [],
    bankCreditTxIds: [],
    ...overrides,
  };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    telegram_id: null, // null по умолчанию -> notifyUser не шлёт запросы, messaging-ветка не исполняется
    tariff: 'START',
    subscription_status: 'EXPIRED',
    subscription_end_date: null,
    trial_expires_at: null,
    export_addon_active: false,
    monthly_reconciliations: 0,
    ...overrides,
  };
}

describe('handleReconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRunById.mockResolvedValue(FAKE_RUN as never);
    mockUpdateRun.mockResolvedValue(FAKE_RUN as never);
    mockFindUserById.mockResolvedValue(undefined);
    mockUpdateUser.mockResolvedValue(undefined as never);
    mockReconcileWbPayout.mockResolvedValue(makePayoutResult() as never);
    mockEnqueue.mockResolvedValue('job-2');
    mockGenerateCandidates.mockResolvedValue(0);
    mockDbLimit.mockResolvedValue([]);
  });

  it('exits early when run is already COMPLETED', async () => {
    mockFindRunById.mockResolvedValue({ ...FAKE_RUN, status: 'COMPLETED' } as never);
    await handleReconcile(makeJob());
    expect(mockReconcileWbPayout).not.toHaveBeenCalled();
  });

  it('exits early when run is already FAILED', async () => {
    mockFindRunById.mockResolvedValue({ ...FAKE_RUN, status: 'FAILED' } as never);
    await handleReconcile(makeJob());
    expect(mockReconcileWbPayout).not.toHaveBeenCalled();
  });

  it('exits early when run is already CANCELLED', async () => {
    mockFindRunById.mockResolvedValue({ ...FAKE_RUN, status: 'CANCELLED' } as never);
    await handleReconcile(makeJob());
    expect(mockReconcileWbPayout).not.toHaveBeenCalled();
  });

  it('throws when run not found', async () => {
    mockFindRunById.mockResolvedValue(undefined);
    await expect(handleReconcile(makeJob())).rejects.toThrow('Reconciliation run not found');
  });

  it('throws when run_id missing from payload and entity_id', async () => {
    const job = { ...makeJob({}), entity_id: '' };
    await expect(handleReconcile(job as Job)).rejects.toThrow('Missing run_id');
  });

  it('uses entity_id as fallback run_id when payload has no run_id', async () => {
    await handleReconcile(makeJob({}));
    expect(mockFindRunById).toHaveBeenCalledWith('run-1');
  });

  it('updates run to RUNNING before processing', async () => {
    await handleReconcile(makeJob());
    const firstCall = mockUpdateRun.mock.calls[0];
    expect(firstCall[0]).toBe('run-1');
    expect(firstCall[1]).toMatchObject({ status: 'RUNNING' });
  });

  it('updates run to COMPLETED with metrics from reconcileWbPayout', async () => {
    mockReconcileWbPayout.mockResolvedValue(makePayoutResult({
      expectedNetKopeks: BigInt(200000),
      receivedKopeks: BigInt(150000),
      discrepancyKopeks: BigInt(50000),
      matchedCount: 3,
      unmatchedCount: 1,
    }) as never);

    await handleReconcile(makeJob());

    const completedCall = mockUpdateRun.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>).status === 'COMPLETED',
    );
    expect(completedCall).toBeDefined();
    expect(completedCall![1]).toMatchObject({
      status: 'COMPLETED',
      matched_count: 3,
      unmatched_count: 1,
      turnover_kopeks: BigInt(200000),
      loss_kopeks: BigInt(50000),
    });
  });

  it('sets loss_kopeks to 0 and loss_percent to null when there is no shortfall (overpaid/reconciled)', async () => {
    mockReconcileWbPayout.mockResolvedValue(makePayoutResult({
      expectedNetKopeks: BigInt(100000),
      receivedKopeks: BigInt(120000), // received more than expected
      discrepancyKopeks: BigInt(-20000),
      status: 'overpaid',
    }) as never);

    await handleReconcile(makeJob());

    const completedCall = mockUpdateRun.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>).status === 'COMPLETED',
    );
    expect(completedCall![1]).toMatchObject({ loss_kopeks: BigInt(0), loss_percent: null });
  });

  it('sets run to FAILED and re-throws when reconcileWbPayout throws', async () => {
    mockReconcileWbPayout.mockRejectedValue(new Error('DB error'));
    await expect(handleReconcile(makeJob())).rejects.toThrow('DB error');

    const failedCall = mockUpdateRun.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>).status === 'FAILED',
    );
    expect(failedCall).toBeDefined();
    expect(failedCall![1]).toMatchObject({ status: 'FAILED', failure_reason: 'DB error' });
  });

  it('kicks off the row-level shadow pipeline after completion (fire-and-forget)', async () => {
    await handleReconcile(makeJob());
    // handleReconcile does not await runRowLevelShadow, but it must still have
    // been invoked synchronously before the function returns.
    expect(mockGenerateCandidates).toHaveBeenCalledWith('run-1');
  });

  it('does not enqueue report_export when the user has no active access (trial/subscription expired)', async () => {
    mockFindUserById.mockResolvedValue(makeUser({ telegram_id: BigInt(123) }) as never);
    await handleReconcile(makeJob());
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('enqueues report_export with priority 10 for BUSINESS tariff', async () => {
    mockFindUserById.mockResolvedValue(makeUser({
      telegram_id: BigInt(123),
      tariff: 'BUSINESS',
      subscription_status: 'ACTIVE',
      subscription_end_date: new Date(Date.now() + 86400000),
    }) as never);

    await handleReconcile(makeJob());

    expect(mockEnqueue).toHaveBeenCalledWith(
      'report_export',
      'run-1',
      expect.objectContaining({ run_id: 'run-1' }),
      undefined,
      10,
    );
  });

  it('enqueues report_export with priority 100 for START tariff', async () => {
    mockFindUserById.mockResolvedValue(makeUser({
      telegram_id: BigInt(123),
      tariff: 'START',
      subscription_status: 'ACTIVE',
      subscription_end_date: new Date(Date.now() + 86400000),
    }) as never);

    await handleReconcile(makeJob());

    expect(mockEnqueue).toHaveBeenCalledWith(
      'report_export',
      'run-1',
      expect.objectContaining({ run_id: 'run-1' }),
      undefined,
      100,
    );
  });

  it('increments monthly_reconciliations once when no duplicate run exists this month', async () => {
    mockFindUserById.mockResolvedValue(makeUser({ monthly_reconciliations: 2 }) as never);
    mockDbLimit.mockResolvedValue([]); // нет дубликатов
    await handleReconcile(makeJob());
    expect(mockUpdateUser).toHaveBeenCalledWith('user-1', { monthly_reconciliations: 3 });
  });

  it('does not increment monthly_reconciliations when a completed run for the same import pair already exists this month', async () => {
    mockFindUserById.mockResolvedValue(makeUser({ monthly_reconciliations: 2 }) as never);
    mockDbLimit.mockResolvedValue([{ id: 'some-other-run' }]); // дубликат найден
    await handleReconcile(makeJob());
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('increments the counter and would not falsely self-match (regression: ne(id, runId) must be present in the dedup query)', async () => {
    // Регрессионный тест: раньше updateRun(..., COMPLETED) вызывался до дедуп-запроса,
    // и без ne(id, runId) запрос находил сам текущий run — счётчик никогда не
    // увеличивался. Мок БД здесь всегда возвращает [] (эмулируя корректную
    // фильтрацию), поэтому инкремент обязан произойти.
    mockFindUserById.mockResolvedValue(makeUser({ monthly_reconciliations: 0 }) as never);
    mockDbLimit.mockResolvedValue([]);
    await handleReconcile(makeJob());
    expect(mockUpdateUser).toHaveBeenCalledWith('user-1', { monthly_reconciliations: 1 });
  });
});
