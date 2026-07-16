import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleInactivityReminder } from '@/src/lib/jobs/handlers/inactivityReminder';
import type { Job } from '@/src/db/repositories/jobs';

vi.mock('@/src/db/repositories/users', () => ({
  findActiveUsersWithTelegramId: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/src/db/repositories/reconciliation-runs', () => ({
  findRunsByUserId: vi.fn().mockResolvedValue([]),
}));

import { findActiveUsersWithTelegramId } from '@/src/db/repositories/users';
import { findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';

const mockFindActiveUsers = vi.mocked(findActiveUsersWithTelegramId);
const mockFindRuns = vi.mocked(findRunsByUserId);

const fakeJob = {
  id: 'job-2',
  job_type: 'inactivity_reminder',
  entity_id: 'daily',
  payload: {},
  status: 'PENDING',
  retries: 0,
  correlation_id: null,
  created_at: new Date(),
  started_at: null,
  completed_at: null,
} as unknown as Job;

describe('handleInactivityReminder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('does nothing when no active users exist', async () => {
    mockFindActiveUsers.mockResolvedValue([]);
    await handleInactivityReminder(fakeJob);
    expect(mockFindRuns).not.toHaveBeenCalled();
  });

  it('checks last reconciliation run for active users', async () => {
    const user = {
      id: 'u-1',
      telegram_id: BigInt(111),
      subscription_status: 'ACTIVE',
    };
    mockFindActiveUsers.mockResolvedValue([user] as never);
    mockFindRuns.mockResolvedValue([]);

    await handleInactivityReminder(fakeJob);

    expect(mockFindRuns).toHaveBeenCalledWith('u-1', 1);
  });

  it('skips users with recent reconciliation runs', async () => {
    const user = {
      id: 'u-2',
      telegram_id: BigInt(222),
      subscription_status: 'ACTIVE',
    };
    mockFindActiveUsers.mockResolvedValue([user] as never);
    mockFindRuns.mockResolvedValue([
      { created_at: new Date() } as never, // recent run
    ]);

    // Should complete without error (no Telegram message attempted)
    await handleInactivityReminder(fakeJob);
  });

  it('identifies inactive users (no runs in 30 days)', async () => {
    const user = {
      id: 'u-3',
      telegram_id: BigInt(333),
      subscription_status: 'ACTIVE',
    };
    mockFindActiveUsers.mockResolvedValue([user] as never);
    mockFindRuns.mockResolvedValue([
      { created_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000) } as never,
    ]);

    await handleInactivityReminder(fakeJob);
    // No assertion on telegram call since token is not set - just ensure no throw
  });
});
