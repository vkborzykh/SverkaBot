import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { findUserById } from '@/src/db/repositories/users';
import { createOrReusePayment } from '@/src/lib/billing/payment';

export async function POST(req: NextRequest) {
  const guard = requireInternalToken(req);
  if (guard) return guard;

  const body = await req.json();
  const userId = body.user_id as string | undefined;

  if (!userId) {
    return errResponse('MISSING_USER_ID', 'user_id is required', 400);
  }

  const user = await findUserById(userId);
  if (!user) {
    return errResponse('USER_NOT_FOUND', 'User not found', 404);
  }

  const paymentUrl = await createOrReusePayment(userId);
  return okResponse({ payment_url: paymentUrl });
}
