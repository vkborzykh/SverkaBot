import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse } from '@/src/lib/http';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = requireInternalToken(req);
  if (guard) return guard;

  // TODO: return import status for params.id, validate ownership via user_id query param
  return okResponse({
    status: 'RECEIVED',
    quality_status: null,
    total_rows: null,
    error_count: null,
    parse_success_rate: null,
    profile_confidence: null,
    profile_status: null,
    profile_id: null,
  });
}
