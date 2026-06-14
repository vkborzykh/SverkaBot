import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

// Disable prefetch for Supabase transaction pooler (port 6543).
// Use the direct connection (port 5432) for migrations.
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
