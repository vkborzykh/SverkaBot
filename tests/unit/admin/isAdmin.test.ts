import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('isAdmin', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns true for telegram IDs in TELEGRAM_ADMIN_IDS', async () => {
    vi.stubEnv('TELEGRAM_ADMIN_IDS', '123456,789012');
    const { isAdmin } = await import('@/src/lib/telegram/handlers/admin');
    expect(isAdmin(BigInt(123456))).toBe(true);
    expect(isAdmin(BigInt(789012))).toBe(true);
  });

  it('returns false for telegram IDs not in TELEGRAM_ADMIN_IDS', async () => {
    vi.stubEnv('TELEGRAM_ADMIN_IDS', '123456,789012');
    const { isAdmin } = await import('@/src/lib/telegram/handlers/admin');
    expect(isAdmin(BigInt(999999))).toBe(false);
  });

  it('returns false when TELEGRAM_ADMIN_IDS is empty', async () => {
    vi.stubEnv('TELEGRAM_ADMIN_IDS', '');
    const { isAdmin } = await import('@/src/lib/telegram/handlers/admin');
    expect(isAdmin(BigInt(123456))).toBe(false);
  });
});
