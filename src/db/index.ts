import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Lazy singleton — only instantiated on first request, not at build time.
let _db: ReturnType<typeof drizzle> | undefined;

export function getDb() {
  if (!_db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    // prepare: false required for Supabase transaction pooler (port 6543).
    // max: 1 — на serverless каждый инстанс функции держит свой пул; Supabase
    // сама рекомендует 1 соединение на инстанс для transaction pooler, иначе
    // при параллельных вызовах Vercel быстро исчерпывает лимит пулера.
    // connect_timeout/idle_timeout — чтобы зависшее соединение к пулеру
    // падало с понятной ошибкой за секунды, а не висело до тайм-аута Vercel.
    const client = postgres(connectionString, {
      prepare: false,
      max: 1,
      connect_timeout: 10,
      idle_timeout: 20,
    });
    _db = drizzle(client, { schema });
  }
  return _db;
}

// Convenience export for direct use in server code.
export { getDb as db };
