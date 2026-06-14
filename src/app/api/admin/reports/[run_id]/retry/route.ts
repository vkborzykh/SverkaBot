import { NextRequest } from 'next/server';
import { requireAdminToken } from '@/src/lib/guards';
import { okResponse } from '@/src/lib/http';

export async function POST(
  req: NextRequest,
  { params }: { params: { run_id: string } },
) {
  const guard = requireAdminToken(req);
  if (guard) return guard;

  // TODO: enqueue report_export job for params.run_id
  return okResponse({ run_id: params.run_id, queued: true });
}
