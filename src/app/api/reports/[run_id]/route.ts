import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse } from '@/src/lib/http';

export async function GET(
  req: NextRequest,
  { params }: { params: { run_id: string } },
) {
  const guard = requireInternalToken(req);
  if (guard) return guard;

  // TODO: return report URL for params.run_id, validate ownership
  return okResponse({ report_url: null });
}
