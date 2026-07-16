import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSubscriptionReminder } from '@/src/lib/jobs/handlers/subscriptionReminder';
import type { Job } from '@/src/db/repositories/jobs';

vi.mock('@/src/db/repositories/users', () => ({
  findUsersExpiringWithinDays: vi.fn().mockResolvedValue([]),
  findExpiredTrialUsers: vi.fn().mockResolvedValue([]),
  updateUser: vi.fn().mockResolvedValue({}),
}));

import {
  findUsersExpiringWithinDays,
  findExpiredTrialUsers,
  updateUser,
} from '@/src/db/repositories/users';

const mockFindExpiring = vi.mocked(findUsersExpiringWithinDays);
const mockFindExpiredTrial = vi.mocked(findExpiredTrialUsers);
const mockUpdateUser = vi.mocked(updateUser);

const fakeJob = {
  id: 'job-1',
  job_type: 'subscription_reminder',
  entity_id: 'daily',
  payload: {},
  status: 'PENDING',
  retries: 0,
  correlation_id: null,
  created_at: new Date(),
  started_at: null,
  completed_at: null,
} as unknown as Job;

describe('handleSubscriptionReminder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // no TELEGRAM_BOT_TOKEN so messages won't send
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('expires trial users whose trial has ended', async () => {
    const expiredUser = {
      id: 'u-1',
      telegram_id: BigInt(111),
      subscription_status: 'TRIAL',
      trial_expires_at: new Date(Date.now() - 1000),
    };
    mockFindExpiredTrial.mockResolvedValue([expiredUser] as never);

    await handleSubscriptionReminder(fakeJob);

    expect(mockUpdateUser).toHaveBeenCalledWith('u-1', {
      subscription_status: 'EXPIRED',
    });
  });

  it('does not expire users if none found', async () => {
    mockFindExpiredTrial.mockResolvedValue([]);
    mockFindExpiring.mockResolvedValue([]);

    await handleSubscriptionReminder(fakeJob);

    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('processes expiring users for reminders', async () => {
    const expiringUser = {
      id: 'u-2',
      telegram_id: BigInt(222),
      subscription_status: 'ACTIVE',
      subscription_end_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    };
    mockFindExpiring.mockResolvedValue([expiringUser] as never);

    // No error thrown without TELEGRAM_BOT_TOKEN
    await handleSubscriptionReminder(fakeJob);
    expect(mockFindExpiring).toHaveBeenCalledWith(3);
  });
});
