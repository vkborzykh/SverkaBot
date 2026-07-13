import { NextRequest } from 'next/server';
import { enqueue } from '@/src/lib/jobs/queue';
import { errResponse, okResponse } from '@/src/lib/http';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return errResponse('UNAUTHORIZED', 'Missing or invalid cron secret', 401);
  }

  try {
    await enqueue('weekly_digest', crypto.randomUUID(), {});
    return okResponse({ ok: true });
  } catch (e) {
    console.error('Failed to enqueue weekly_digest:', e);
    return errResponse('INTERNAL_ERROR', 'Failed to enqueue', 500);
  }
}
