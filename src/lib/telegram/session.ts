import { sql } from 'drizzle-orm';
import { getDb } from '@/src/db/index';

// Conversation state for the Telegram bot. Previously kept in an in-memory Map,
// which does NOT survive between serverless invocations on Vercel — the "send
// me the file" request and the "file arrived" request often hit different
// instances, so the upload matched no session and was silently ignored.
//
// Now persisted in the telegram_sessions table (see migration 008). Functions
// are async; all callers must await them.

export type SessionState =
  | 'awaiting_wb_file'
  | 'awaiting_bank_file';

const TTL_MINUTES = 60;

export async function setSession(telegramId: bigint, state: SessionState): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    INSERT INTO telegram_sessions (telegram_id, state, updated_at, expires_at)
    VALUES (${telegramId}, ${state}, now(), now() + make_interval(mins => ${TTL_MINUTES}))
    ON CONFLICT (telegram_id) DO UPDATE
      SET state = EXCLUDED.state,
          updated_at = now(),
          expires_at = EXCLUDED.expires_at
  `);
}

export async function getSession(telegramId: bigint): Promise<SessionState | null> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT state FROM telegram_sessions
    WHERE telegram_id = ${telegramId} AND expires_at > now()
  `);
  const row = (rows as unknown as Array<{ state: string }>)[0];
  return (row?.state as SessionState) ?? null;
}

export async function clearSession(telegramId: bigint): Promise<void> {
  const db = getDb();
  await db.execute(sql`DELETE FROM telegram_sessions WHERE telegram_id = ${telegramId}`);
}
