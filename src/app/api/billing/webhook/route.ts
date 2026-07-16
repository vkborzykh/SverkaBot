import { NextRequest } from 'next/server';
import { okResponse, errResponse } from '@/src/lib/http';
import { YooKassaProvider } from '@/src/lib/billing/provider';
import {
  findBillingTransactionByProviderTxId,
  updateBillingTransaction,
} from '@/src/db/repositories/billing-transactions';
import { activateSubscription } from '@/src/lib/billing/subscription';
import { findUserById } from '@/src/db/repositories/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUBSCRIPTION_DAYS = 30;

export async function POST(req: NextRequest) {
  let body: { event?: string; object?: { id?: string } };
  try {
    body = await req.json();
  } catch {
    return errResponse('INVALID_REQUEST', 'bad json', 400);
  }

  const paymentId = body?.object?.id;
  if (!paymentId) return okResponse({ ok: true }); // ack unknown shape

  // Подтверждение подлинности: перезапрос статуса платежа напрямую у YooKassa
  const provider = new YooKassaProvider();
  let payment: { status: string };
  try {
    payment = await provider.getPayment(paymentId);
  } catch {
    return errResponse('DEPENDENCY_ERROR', 'verification failed', 502);
  }

  if (payment.status !== 'succeeded') {
    if (payment.status === 'canceled') {
      const tx = await findBillingTransactionByProviderTxId(paymentId);
      if (tx && tx.status === 'PENDING')
        await updateBillingTransaction(tx.id, { status: 'FAILED' });
    }
    return okResponse({ ok: true });
  }

  const tx = await findBillingTransactionByProviderTxId(paymentId);
  if (!tx) return okResponse({ ok: true });            // неизвестная транзакция – ack
  if (tx.status === 'SUCCESS') return okResponse({ ok: true }); // идемпотентность

  await updateBillingTransaction(tx.id, { status: 'SUCCESS' });
  const endDate = await activateSubscription(tx.user_id, SUBSCRIPTION_DAYS);

  const user = await findUserById(tx.user_id);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (user?.telegram_id && token) {
    const formatted = endDate.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    });
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(user.telegram_id),
        text: `Оплата прошла успешно! Ваша подписка активна до ${formatted}. Спасибо!`,
      }),
    }).catch(() => {});
  }

  return okResponse({ ok: true });
}
