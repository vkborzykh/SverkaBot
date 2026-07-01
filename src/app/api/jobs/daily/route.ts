import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { enqueue } from '@/src/lib/jobs/queue';
import { drainQueue } from '@/src/lib/jobs/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function runDaily() {
  const [subReminderId, inactivityId] = await Promise.all([
    enqueue('subscription_reminder', 'daily', { triggered_at: new Date().toISOString() }),
    enqueue('inactivity_reminder', 'daily', { triggered_at: new Date().toISOString() }),
  ]);

  let processed = 0;
  if ((process.env.QUEUE_DRIVER ?? 'db') !== 'bull') {
    processed = await drainQueue();
  }

  return okResponse({
    enqueued: {
      subscription_reminder: subReminderId,
      inactivity_reminder: inactivityId,
    },
    processed,
  });
}

export async function POST(req: NextRequest) {
  const guard = requireInternalToken(req);
  if (guard) return guard;
  return runDaily();
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return errResponse('UNAUTHORIZED', 'Missing or invalid cron secret', 401);
  }
  return runDaily();
}
// cache bust
