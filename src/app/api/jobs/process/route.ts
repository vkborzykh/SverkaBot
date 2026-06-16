import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { drainQueue } from '@/src/lib/jobs/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Hobby ceiling is 60s; raise to 300 on Pro for very large files.
export const maxDuration = 60;

async function run() {
  try {
    const processed = await drainQueue();
    return okResponse({ processed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errResponse('DB_ERROR', msg, 500);
  }
}

// Internal/manual trigger (bot layer or ops) — authenticated by X-Internal-Token.
export async function POST(req: NextRequest) {
  const guard = requireInternalToken(req);
  if (guard) return guard;
  return run();
}

// Vercel Cron trigger — Vercel sends GET with `Authorization: Bearer $CRON_SECRET`.
// On Hobby, cron runs daily (see /api/jobs/daily, which is the scheduled entry
// point); this GET is kept for manual checks and for a minute-level cron on Pro.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return errResponse('UNAUTHORIZED', 'Missing or invalid cron secret', 401);
  }
  return run();
}
