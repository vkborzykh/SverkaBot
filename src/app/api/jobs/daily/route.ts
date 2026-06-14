import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse } from '@/src/lib/http';
import { enqueue } from '@/src/lib/jobs/queue';

export async function POST(req: NextRequest) {
  const guard = requireInternalToken(req);
  if (guard) return guard;

  const [subReminderId, inactivityId] = await Promise.all([
    enqueue('subscription_reminder', 'daily', { triggered_at: new Date().toISOString() }),
    enqueue('inactivity_reminder', 'daily', { triggered_at: new Date().toISOString() }),
  ]);

  return okResponse({
    enqueued: {
      subscription_reminder: subReminderId,
      inactivity_reminder: inactivityId,
    },
  });
}
