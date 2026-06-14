const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type ConversationState = 'awaiting_turnover' | 'awaiting_wb_file' | 'awaiting_bank_file';

interface SessionEntry {
  state: ConversationState;
  expiresAt: number;
}

const sessions = new Map<string, SessionEntry>();

export function setSession(telegramId: bigint, state: ConversationState): void {
  sessions.set(String(telegramId), {
    state,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
}

export function getSession(telegramId: bigint): ConversationState | undefined {
  const key = String(telegramId);
  const entry = sessions.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    sessions.delete(key);
    return undefined;
  }
  return entry.state;
}

export function clearSession(telegramId: bigint): void {
  sessions.delete(String(telegramId));
}
