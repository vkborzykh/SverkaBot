import { NextRequest } from 'next/server';
import { requireInternalToken } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { findUserById } from '@/src/db/repositories/users';
import {
  createBillingTransaction,
  findPendingTransactionByUserId,
} from '@/src/db/repositories/billing-transactions';
import { getPaymentProvider } from '@/src/lib/billing/provider';

const SUBSCRIPTION_AMOUNT_KOPEKS = 150000; // 1500 RUB
const CURRENCY = 'RUB';

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

  // If there's already a pending transaction, reuse it
  const pending = await findPendingTransactionByUserId(userId);
  if (pending && pending.provider_tx_id) {
    const provider = getPaymentProvider();
    const { paymentUrl } = await provider.createPayment(
      SUBSCRIPTION_AMOUNT_KOPEKS,
      CURRENCY,
      { userId },
    );
    return okResponse({ payment_url: paymentUrl });
  }

  const provider = getPaymentProvider();
  const { paymentUrl, providerTxId } = await provider.createPayment(
    SUBSCRIPTION_AMOUNT_KOPEKS,
    CURRENCY,
    { userId, description: 'Подписка SverkaBot 30 дней' },
  );

  await createBillingTransaction({
    user_id: userId,
    amount_kopeks: BigInt(SUBSCRIPTION_AMOUNT_KOPEKS),
    currency: CURRENCY,
    status: 'PENDING',
    provider: 'mock',
    provider_tx_id: providerTxId,
  });

  return okResponse({ payment_url: paymentUrl });
}
