// Shared ioredis connection for BullMQ (queue, worker, poller).
// Works with local Redis (redis://127.0.0.1:6379, no TLS) and with a managed
// rediss:// endpoint (TLS auto-enabled by ioredis from the URL scheme).

import { Redis } from 'ioredis';

let _connection: Redis | undefined;

export function getRedisConnection(): Redis {
  if (_connection) return _connection;

  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');

  // maxRetriesPerRequest: null is REQUIRED by BullMQ — otherwise ioredis aborts
  // the blocking commands the worker relies on and BullMQ throws on startup.
  _connection = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  _connection.on('error', (err) => console.error('[redis] error:', err.message));
  _connection.on('connect', () => console.log('[redis] connected'));

  return _connection;
}

export async function closeRedisConnection(): Promise<void> {
  if (_connection) {
    await _connection.quit();
    _connection = undefined;
  }
}
