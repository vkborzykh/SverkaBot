import type { Context } from 'telegraf';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { getPaymentProvider } from '@/src/lib/billing/provider';
import {
  createBillingTransaction,
  findPendingTransactionByUserId,
} from '@/src/db/repositories/billing-transactions';
import { msg } from '../messages.ru';

const SUBSCRIPTION_AMOUNT_KOPEKS = 150000; // 1500 RUB
const CURRENCY = 'RUB';

async function getOrCreatePaymentUrl(userId: string): Promise<string> {
  const provider = getPaymentProvider();

  // Reuse pending transaction if exists
  const pending = await findPendingTransactionByUserId(userId);
  if (pending && pending.provider_tx_id) {
    const { paymentUrl } = await provider.createPayment(
      SUBSCRIPTION_AMOUNT_KOPEKS,
      CURRENCY,
      { userId },
    );
    return paymentUrl;
  }

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

  return paymentUrl;
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return '—';
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export async function handleSubscribe(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) {
    await ctx.reply(msg.accessExpired);
    return;
  }

  const paymentUrl = await getOrCreatePaymentUrl(user.id);

  switch (user.subscription_status) {
    case 'TRIAL': {
      const expiryDate = formatDate(user.trial_expires_at);
      await ctx.reply(msg.subscribeTrialStatus(expiryDate, paymentUrl));
      break;
    }
    case 'ACTIVE': {
      const expiryDate = formatDate(user.subscription_end_date);
      await ctx.reply(msg.subscribeActiveStatus(expiryDate, paymentUrl));
      break;
    }
    case 'EXPIRED':
    default:
      await ctx.reply(msg.subscribeExpiredStatus(paymentUrl));
      break;
  }
}
