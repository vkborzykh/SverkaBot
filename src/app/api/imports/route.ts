import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse } from '@/src/lib/http';

export async function GET(req: NextRequest) {
  const guard = requireInternalToken(req);
  if (guard) return guard;

  // TODO: list imports filtered by user_id, source_type, status, limit, period
  return okResponse({ imports: [] });
}
