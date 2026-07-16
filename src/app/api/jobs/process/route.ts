import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { drainQueue } from '@/src/lib/jobs/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function run() {
  // Under BullMQ, the always-on worker's poller drains the queue. This route
  // must not also drain, or jobs would be processed twice.
  if ((process.env.QUEUE_DRIVER ?? 'db') === 'bull') {
    return okResponse({ processed: 0, skipped: 'QUEUE_DRIVER=bull' });
  }
  try {
    const processed = await drainQueue();
    return okResponse({ processed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errResponse('DB_ERROR', msg, 500);
  }
}

export async function POST(req: NextRequest) {
  const guard = requireInternalToken(req);
  if (guard) return guard;
  return run();
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return errResponse('UNAUTHORIZED', 'Missing or invalid cron secret', 401);
  }
  return run();
}
