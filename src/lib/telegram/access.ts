import type { User } from '@/src/db/repositories/users';

export type AccessLevel = 'full' | 'readonly' | 'none';

export function checkAccess(user: User): AccessLevel {
  const now = new Date();

  if (user.subscription_status === 'ACTIVE') {
    if (user.subscription_end_date && user.subscription_end_date > now) {
      return 'full';
    }
    return 'readonly';
  }

  if (user.subscription_status === 'TRIAL') {
    if (user.trial_expires_at && user.trial_expires_at > now) {
      return 'full';
    }
    return 'readonly';
  }

  // EXPIRED
  return 'readonly';
}

// Commands that require 'full' access
export const PROTECTED_COMMANDS = new Set([
  'upload_wb',
  'upload_bank',
  'run_sync',
]);

// Commands allowed for 'readonly' access
export const READONLY_COMMANDS = new Set(['history', 'get_report']);
