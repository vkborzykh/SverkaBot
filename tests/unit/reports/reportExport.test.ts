import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleReportExport } from '@/src/lib/jobs/handlers/reportExport';
import type { Job } from '@/src/db/repositories/jobs';

vi.mock('@/src/db/repositories/reconciliation-runs', () => ({
  findRunById: vi.fn(),
}));
vi.mock('@/src/db/repositories/reconciliation-matches', () => ({
  findMatchesByRunId: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/db/repositories/reconciliation-match-items', () => ({
  findMatchItemsByMatchId: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/db/repositories/reconciliation-evidence', () => ({
  findEvidenceByMatchId: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/src/db/repositories/canonical-transactions', () => ({
  findTransactionsByImportId: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/db/repositories/parsing-errors', () => ({
  findParsingErrorsByImportId: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/src/db/repositories/users', () => ({
  findUserById: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/src/db/repositories/reports', () => ({
  findPrimaryReportByRunId: vi.fn(),
  createReport: vi.fn().mockResolvedValue({ id: 'report-1' }),
}));
vi.mock('@/src/lib/ingestion/storage', () => ({
  storeReport: vi.fn().mockResolvedValue('reports/run-1/report.zip'),
  getStorageFilePath: vi.fn().mockReturnValue('/tmp/reports/run-1/report.zip'),
}));
vi.mock('@/src/lib/reports/zip', () => ({
  createZip: vi.fn().mockResolvedValue(Buffer.from('ZIPDATA')),
}));

import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findPrimaryReportByRunId, createReport } from '@/src/db/repositories/reports';
import { storeReport } from '@/src/lib/ingestion/storage';
import { createZip } from '@/src/lib/reports/zip';

const mockFindRunById = vi.mocked(findRunById);
const mockFindPrimaryReport = vi.mocked(findPrimaryReportByRunId);
const mockCreateReport = vi.mocked(createReport);
const mockStoreReport = vi.mocked(storeReport);
const mockCreateZip = vi.mocked(createZip);

const FAKE_RUN = {
  id: 'run-1',
  user_id: 'user-1',
  wb_import_id: 'wb-1',
  bank_import_id: 'bank-1',
  status: 'COMPLETED',
  total_wb_rows: 10,
  total_bank_rows: 15,
  matched_count: 8,
  unmatched_count: 2,
  ambiguous_count: 0,
  split_count: 0,
  combined_count: 0,
  match_rate: '80.00',
  unmatched_amount: BigInt(100000),
  ambiguous_amount: BigInt(0),
  started_at: new Date(),
  completed_at: new Date(),
  created_at: new Date(),
  updated_at: new Date(),
  failure_reason: null,
};

function makeJob(payload: Record<string, string> = {}): Job {
  return {
    id: 'job-1',
    job_type: 'report_export',
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
  } as never;
}

describe('handleReportExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindRunById.mockResolvedValue(FAKE_RUN as never);
    mockFindPrimaryReport.mockResolvedValue(undefined);
    mockCreateReport.mockResolvedValue({ id: 'report-1' } as never);
    mockStoreReport.mockResolvedValue('reports/run-1/report.zip');
    mockCreateZip.mockResolvedValue(Buffer.from('ZIPDATA'));
  });

  it('exits early if primary report already exists (idempotency)', async () => {
    mockFindPrimaryReport.mockResolvedValue({ id: 'existing-report' } as never);
    await handleReportExport(makeJob({ run_id: 'run-1' }));
    expect(mockCreateZip).not.toHaveBeenCalled();
    expect(mockCreateReport).not.toHaveBeenCalled();
  });

  it('exits early if run is not COMPLETED', async () => {
    mockFindRunById.mockResolvedValue({ ...FAKE_RUN, status: 'RUNNING' } as never);
    await handleReportExport(makeJob({ run_id: 'run-1' }));
    expect(mockCreateZip).not.toHaveBeenCalled();
  });

  it('throws when run not found', async () => {
    mockFindRunById.mockResolvedValue(undefined);
    await expect(handleReportExport(makeJob({ run_id: 'run-1' }))).rejects.toThrow();
  });

  it('creates ZIP with 9 CSV files', async () => {
    await handleReportExport(makeJob({ run_id: 'run-1' }));
    expect(mockCreateZip).toHaveBeenCalledTimes(1);
    const files = mockCreateZip.mock.calls[0][0];
    const fileNames = Object.keys(files);
    expect(fileNames).toContain('summary.csv');
    expect(fileNames).toContain('matched.csv');
    expect(fileNames).toContain('unmatched.csv');
    expect(fileNames).toContain('ambiguous.csv');
    expect(fileNames).toContain('wb_rows.csv');
    expect(fileNames).toContain('bank_rows.csv');
    expect(fileNames).toContain('evidence.csv');
    expect(fileNames).toContain('parsing_errors.csv');
    expect(fileNames).toContain('metrics.csv');
    expect(fileNames.length).toBe(9);
  });

  it('stores ZIP and creates report record', async () => {
    await handleReportExport(makeJob({ run_id: 'run-1' }));
    expect(mockStoreReport).toHaveBeenCalledWith('run-1', Buffer.from('ZIPDATA'));
    expect(mockCreateReport).toHaveBeenCalledWith({
      run_id: 'run-1',
      storage_path: 'reports/run-1/report.zip',
      export_type: 'ZIP',
      report_version: 1,
      is_primary: true,
    });
  });

  it('uses entity_id as fallback when payload has no run_id', async () => {
    await handleReportExport(makeJob());
    expect(mockFindRunById).toHaveBeenCalledWith('run-1');
  });
});
