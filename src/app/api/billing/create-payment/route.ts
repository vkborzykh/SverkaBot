import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse } from '@/src/lib/http';

export async function POST(req: NextRequest) {
  const guard = requireInternalToken(req);
  if (guard) return guard;

  // TODO: create payment link for user
  return okResponse({ payment_url: null });
}
