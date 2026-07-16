import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse } from '@/src/lib/http';

export async function GET(req: NextRequest) {
  const guard = requireInternalToken(req);
  if (guard) return guard;

  // TODO: return last 10 reconciliation runs for user_id query param
  return okResponse({ runs: [] });
}
