import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/src/db/index';
import { telegramSessions } from '@/src/db/schema';

export type SessionState =
  | 'awaiting_wb_file'
  | 'awaiting_bank_file'
  | 'reconciliation_active';   // новая операция сверки

const SESSION_TTL_MINUTES = 30;

function expiresAt(): Date {
  return new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000);
}

export async function getSession(telegramId: bigint): Promise<SessionState | null> {
  const db = getDb();
  const rows = await db
    .select({ state: telegramSessions.state })
    .from(telegramSessions)
    .where(
      eq(telegramSessions.telegram_id, telegramId),
      sql`${telegramSessions.expires_at} > now()`,
    )
    .limit(1);
  return rows.length > 0 ? (rows[0].state as SessionState) : null;
}

export async function getSessionPayload(
  telegramId: bigint,
): Promise<Record<string, unknown> | null> {
  const db = getDb();
  const rows = await db
    .select({ payload: telegramSessions.payload })
    .from(telegramSessions)
    .where(
      eq(telegramSessions.telegram_id, telegramId),
      sql`${telegramSessions.expires_at} > now()`,
    )
    .limit(1);
  return rows.length > 0 ? (rows[0].payload as Record<string, unknown>) : null;
}

export async function setSession(
  telegramId: bigint,
  state: SessionState,
  payload?: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db
    .insert(telegramSessions)
    .values({
      telegram_id: telegramId,
      state,
      payload: payload ?? {},
      updated_at: new Date(),
      expires_at: expiresAt(),
    })
    .onConflictDoUpdate({
      target: telegramSessions.telegram_id,
      set: {
        state,
        payload: payload ?? {},
        updated_at: new Date(),
        expires_at: expiresAt(),
      },
    });
}

export async function updateSessionPayload(
  telegramId: bigint,
  payload: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db
    .update(telegramSessions)
    .set({ payload, updated_at: new Date() })
    .where(eq(telegramSessions.telegram_id, telegramId));
}

export async function clearSession(telegramId: bigint): Promise<void> {
  const db = getDb();
  await db
    .delete(telegramSessions)
    .where(eq(telegramSessions.telegram_id, telegramId));
}
