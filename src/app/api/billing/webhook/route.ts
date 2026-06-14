import { NextRequest } from 'next/server';
import { okResponse, errResponse } from '@/src/lib/http';
import {
  findBillingTransactionByProviderTxId,
  updateBillingTransaction,
} from '@/src/db/repositories/billing-transactions';
import { findUserById } from '@/src/db/repositories/users';
import { activateSubscription } from '@/src/lib/billing/subscription';
import { getPaymentProvider } from '@/src/lib/billing/provider';

const SUBSCRIPTION_DAYS = 30;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const signature = req.headers.get('x-payment-signature') ?? '';

  const provider = getPaymentProvider();
  if (!provider.verifyWebhook(body, signature)) {
    return errResponse('INVALID_SIGNATURE', 'Webhook signature invalid', 403);
  }

  const providerTxId = body.provider_tx_id as string | undefined;
  if (!providerTxId) {
    return errResponse('MISSING_TX_ID', 'provider_tx_id is required', 400);
  }

  const tx = await findBillingTransactionByProviderTxId(providerTxId);
  if (!tx) {
    return errResponse('TX_NOT_FOUND', 'Transaction not found', 404);
  }

  // Idempotency: already processed
  if (tx.status === 'SUCCESS') {
    return okResponse({ already_processed: true });
  }

  // Update transaction status
  await updateBillingTransaction(tx.id, { status: 'SUCCESS' });

  // Activate subscription
  const endDate = await activateSubscription(tx.user_id, SUBSCRIPTION_DAYS);

  // Send Telegram notification
  const user = await findUserById(tx.user_id);
  if (user?.telegram_id) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      const formatted = endDate.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
      });
      const text = `Оплата прошла успешно! Ваша подписка активна до ${formatted}. Спасибо!`;
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(user.telegram_id), text }),
      }).catch(() => {});
    }
  }

  return okResponse({ success: true, subscription_end_date: endDate.toISOString() });
}
