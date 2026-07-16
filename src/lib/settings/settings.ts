import { findSettingByKey } from '@/src/db/repositories/settings';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

/**
 * Retrieve a typed setting value by key with a 60-second in-memory cache.
 * Returns undefined if the key does not exist in the database.
 */
export async function getSetting<T>(key: string): Promise<T | undefined> {
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const row = await findSettingByKey(key);
  const value = row?.value_json as T | undefined;

  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });

  return value;
}

/** Invalidate a specific key from the in-memory cache (e.g. after an admin update). */
export function invalidateSetting(key: string): void {
  cache.delete(key);
}

/** Invalidate the entire settings cache. */
export function invalidateAllSettings(): void {
  cache.clear();
}
