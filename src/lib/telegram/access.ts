// Access control logic for Telegram bot users.
// Admins (TELEGRAM_ADMIN_IDS) are subject to the same paywall as regular users,
// but they can always use administrative commands.

export type AccessLevel = 'full' | 'readonly' | 'none';

export const PROTECTED_COMMANDS = new Set([
  'upload_wb',
  'upload_bank',
  'run_sync',
  'history',
  'subscribe',
  'help',
  'get_report',
  'status',
  'sync_status',
  'delete_my_data',
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
}): AccessLevel {
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

  // Expired — read only for everyone, including admins
  return 'readonly';
}
