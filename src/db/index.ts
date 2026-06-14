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
    const client = postgres(connectionString, { prepare: false });
    _db = drizzle(client, { schema });
  }
  return _db;
}

// Convenience export for direct use in server code.
export { getDb as db };
