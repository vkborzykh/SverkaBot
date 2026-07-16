-- 008: Telegram bot conversation state.
-- Replaces the in-memory session Map, which did not survive between serverless
-- invocations on Vercel (causing uploads to be silently ignored).

CREATE TABLE IF NOT EXISTS telegram_sessions (
  telegram_id BIGINT PRIMARY KEY,
  state       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '1 hour')
);

CREATE INDEX IF NOT EXISTS telegram_sessions_expires_at_idx
  ON telegram_sessions (expires_at);
