import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteUserData } from '@/src/lib/users/deletion';

const mockExecute = vi.fn().mockResolvedValue([]);
const mockFindUserById = vi.fn();
const mockDeleteFile = vi.fn().mockResolvedValue(undefined);
const mockDeleteDirectory = vi.fn().mockResolvedValue(undefined);

vi.mock('@/src/db/index', () => ({
  getDb: () => ({
    execute: mockExecute,
  }),
}));

vi.mock('@/src/db/repositories/users', () => ({
  findUserById: (...args: unknown[]) => mockFindUserById(...args),
}));

vi.mock('@/src/lib/ingestion/storage', () => ({
  deleteFile: (...args: unknown[]) => mockDeleteFile(...args),
  deleteDirectory: (...args: unknown[]) => mockDeleteDirectory(...args),
}));

const FAKE_USER = {
  id: 'user-1',
  telegram_id: BigInt(123456),
  username: 'testuser',
  subscription_status: 'ACTIVE',
  consent_given_at: new Date(),
  trial_expires_at: new Date(),
  subscription_end_date: new Date(),
  last_update_id: null,
  created_at: new Date(),
  updated_at: new Date(),
  deleted_at: null,
};

describe('deleteUserData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUserById.mockResolvedValue(FAKE_USER);
    // Порядок db.execute() в реальной реализации (src/lib/users/deletion.ts):
    // 1) imports query, 2) runCount query, 3) reports query, далее — deletes/updates.
    mockExecute
      .mockResolvedValueOnce([
        { id: 'imp-1', storage_path: 'imports/user-1/abc.xlsx' },
        { id: 'imp-2', storage_path: 'imports/user-1/def.csv' },
      ])
      .mockResolvedValueOnce([{ c: 1 }]) // runCount
      .mockResolvedValueOnce([
        // ZIP отчётов в продукте нет (HTML — первичный формат); реальный
        // storage_path соответствует src/db/schema.ts / DB Draft.
        { storage_path: 'reports/user-1/run-1/report.html', run_id: 'run-1' },
      ])
      .mockResolvedValue([]);
  });

  it('throws if user not found', async () => {
    mockFindUserById.mockResolvedValue(undefined);
    await expect(deleteUserData('bad-id')).rejects.toThrow('User not found');
  });

  it('deletes import files from storage', async () => {
    await deleteUserData('user-1');

    expect(mockDeleteFile).toHaveBeenCalledWith('imports/user-1/abc.xlsx');
    expect(mockDeleteFile).toHaveBeenCalledWith('imports/user-1/def.csv');
  });

  it('deletes report files and directories from storage', async () => {
    await deleteUserData('user-1');

    expect(mockDeleteFile).toHaveBeenCalledWith('reports/user-1/run-1/report.html');
    expect(mockDeleteDirectory).toHaveBeenCalledWith('reports/run-1');
  });

  it('executes database operations in correct order', async () => {
    await deleteUserData('user-1');

    // Total DB calls: imports + runCount + reports queries + multiple deletes/updates
    const calls = mockExecute.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(8);
  });

  it('makes correct number of storage delete calls', async () => {
    await deleteUserData('user-1');

    // 2 import files + 1 report file = 3 deleteFile calls
    expect(mockDeleteFile).toHaveBeenCalledTimes(3);
    // 1 report directory
    expect(mockDeleteDirectory).toHaveBeenCalledTimes(1);
  });
});
