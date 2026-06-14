import { describe, it, expect, vi, beforeEach } from 'vitest';
import { activateSubscription, expireSubscription } from '@/src/lib/billing/subscription';

vi.mock('@/src/db/repositories/users', () => ({
  findUserById: vi.fn(),
  updateUser: vi.fn().mockResolvedValue({}),
}));

import { findUserById, updateUser } from '@/src/db/repositories/users';

const mockFindUserById = vi.mocked(findUserById);
const mockUpdateUser = vi.mocked(updateUser);

function makeUser(overrides = {}) {
  return {
    id: 'user-1',
    telegram_id: BigInt(123456),
    username: 'test',
    consent_given_at: new Date(),
    trial_expires_at: new Date(),
    subscription_status: 'TRIAL' as const,
    subscription_end_date: null,
    last_update_id: null,
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
    ...overrides,
  };
}

describe('subscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('activateSubscription', () => {
    it('sets status to ACTIVE and end date to now + days', async () => {
      mockFindUserById.mockResolvedValue(makeUser() as never);
      mockUpdateUser.mockResolvedValue(makeUser({ subscription_status: 'ACTIVE' }) as never);

      const endDate = await activateSubscription('user-1', 30);

      expect(mockUpdateUser).toHaveBeenCalledWith('user-1', {
        subscription_status: 'ACTIVE',
        subscription_end_date: expect.any(Date),
      });

      const now = new Date();
      const expectedEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      // Allow 5 seconds tolerance
      expect(Math.abs(endDate.getTime() - expectedEnd.getTime())).toBeLessThan(5000);
    });

    it('extends from current end date if already active', async () => {
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      mockFindUserById.mockResolvedValue(
        makeUser({
          subscription_status: 'ACTIVE',
          subscription_end_date: futureDate,
        }) as never,
      );
      mockUpdateUser.mockResolvedValue(makeUser() as never);

      const endDate = await activateSubscription('user-1', 30);

      const expectedEnd = new Date(futureDate.getTime() + 30 * 24 * 60 * 60 * 1000);
      expect(Math.abs(endDate.getTime() - expectedEnd.getTime())).toBeLessThan(5000);
    });

    it('throws if user not found', async () => {
      mockFindUserById.mockResolvedValue(undefined);
      await expect(activateSubscription('bad-id', 30)).rejects.toThrow('User not found');
    });
  });

  describe('expireSubscription', () => {
    it('sets status to EXPIRED', async () => {
      mockUpdateUser.mockResolvedValue(makeUser({ subscription_status: 'EXPIRED' }) as never);

      await expireSubscription('user-1');

      expect(mockUpdateUser).toHaveBeenCalledWith('user-1', {
        subscription_status: 'EXPIRED',
      });
    });
  });
});
