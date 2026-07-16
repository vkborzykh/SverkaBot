import { NextRequest } from 'next/server';
import { requireAdminToken } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { findProfileById, updateProfile } from '@/src/db/repositories/statement-profiles';
import { logAuditEvent } from '@/src/lib/audit/audit';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const guard = requireAdminToken(req);
  if (guard) return guard;

  const profile = await findProfileById(params.id);
  if (!profile) {
    return errResponse('PROFILE_NOT_FOUND', 'Profile not found', 404);
  }

  const updated = await updateProfile(params.id, { status: 'DEPRECATED' });

  await logAuditEvent(null, 'profile_deprecated', {
    profile_id: params.id,
    previous_status: profile.status,
  });

  return okResponse({ id: params.id, status: updated?.status ?? 'DEPRECATED' });
}
