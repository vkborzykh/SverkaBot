import type { Context } from 'telegraf';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { createOrReusePayment } from '@/src/lib/billing/payment';
import { msg } from '../messages.ru';

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

  const paymentUrl = await createOrReusePayment(user.id);

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
