import { getPaymentProvider } from './provider';
import {
  createBillingTransaction,
  findPendingTransactionByUserId,
  updateBillingTransaction,
} from '@/src/db/repositories/billing-transactions';

const SUBSCRIPTION_AMOUNT_KOPEKS = 150000; // 1500 RUB
const CURRENCY = 'RUB';

export async function createOrReusePayment(userId: string): Promise<string> {
  const pending = await findPendingTransactionByUserId(userId);
  if (pending?.confirmation_url) return pending.confirmation_url;

  const provider = getPaymentProvider();
  const { paymentUrl, providerTxId } = await provider.createPayment(
    SUBSCRIPTION_AMOUNT_KOPEKS,
    CURRENCY,
    { userId, description: 'Подписка SverkaBot 30 дней' },
  );
  const providerName = process.env.PAYMENT_PROVIDER ?? 'mock';

  if (pending) {
    await updateBillingTransaction(pending.id, {
      provider: providerName,
      provider_tx_id: providerTxId,
      confirmation_url: paymentUrl,
    });
  } else {
    await createBillingTransaction({
      user_id: userId,
      amount_kopeks: BigInt(SUBSCRIPTION_AMOUNT_KOPEKS),
      currency: CURRENCY,
      status: 'PENDING',
      provider: providerName,
      provider_tx_id: providerTxId,
      confirmation_url: paymentUrl,
    });
  }
  return paymentUrl;
}
