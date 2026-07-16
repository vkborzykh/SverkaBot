import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { enqueue } from '@/src/lib/jobs/queue';
import { drainQueue } from '@/src/lib/jobs/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function runAnnualUpgrade() {
  const jobId = await enqueue('annual_upgrade_suggestion', 'annual_upgrade', {
    triggered_at: new Date().toISOString(),
  });

  let processed = 0;
  if ((process.env.QUEUE_DRIVER ?? 'db') !== 'bull') {
    processed = await drainQueue();
  }

  return okResponse({
    enqueued: { annual_upgrade_suggestion: jobId },
    processed,
  });
}

export async function POST(req: NextRequest) {
  const guard = requireInternalToken(req);
  if (guard) return guard;
  return runAnnualUpgrade();
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return errResponse('UNAUTHORIZED', 'Missing or invalid cron secret', 401);
  }
  return runAnnualUpgrade();
}
