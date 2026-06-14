import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse } from '@/src/lib/http';

export async function POST(req: NextRequest) {
  const guard = requireInternalToken(req);
  if (guard) return guard;

  // TODO: execute canonical deletion sequence for user_id body param
  return okResponse({ deleted: true });
}
