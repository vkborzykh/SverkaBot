// Access control logic for Telegram bot users.
// Admins (TELEGRAM_ADMIN_IDS) always have full access regardless of subscription status,
// so they can test and administer the bot without restrictions.

export type AccessLevel = 'full' | 'readonly' | 'none';

export const PROTECTED_COMMANDS = new Set([
  'upload_wb',
  'upload_bank',
  'run_sync',
  'history',
  'get_report',
  'status',
  'sync_status',
  'retry_import',
  'cancel',
]);

export function isAdmin(telegramId: bigint): boolean {
  const adminIds = (process.env.TELEGRAM_ADMIN_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map(BigInt);
  return adminIds.includes(telegramId);
}

export function checkAccess(user: {
  subscription_status: string | null;
  trial_expires_at: Date | null;
  subscription_end_date: Date | null;
  telegram_id: bigint | null;
} | undefined): AccessLevel {
  if (!user) return 'none';

  // Admins always have full access
  if (user.telegram_id && isAdmin(user.telegram_id)) {
    return 'full';
  }

  const now = new Date();

  // Active subscription
  if (
    user.subscription_status === 'ACTIVE' &&
    user.subscription_end_date &&
    new Date(user.subscription_end_date) > now
  ) {
    return 'full';
  }

  // Active trial
  if (
    user.subscription_status === 'TRIAL' &&
    user.trial_expires_at &&
    new Date(user.trial_expires_at) > now
  ) {
    return 'full';
  }

  // Expired — read only for everyone else
  return 'readonly';
}
