import { NextRequest } from 'next/server';
import { requireAdminToken } from '@/src/lib/guards';
import { okResponse } from '@/src/lib/http';

export async function GET(req: NextRequest) {
  const guard = requireAdminToken(req);
  if (guard) return guard;

  // TODO: return truncated parsing errors from last 30 days
  return okResponse({ errors: [] });
}
