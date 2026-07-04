import type { Context } from 'telegraf';
import { findUserByTelegramId, findUsersByInvitedBy } from '@/src/db/repositories/users';
import { msg } from '../messages.ru';

const FULL_PRICE_KOPEKS = 150000;   // 1 500 ₽
const DISCOUNT_PRICE_KOPEKS = 120000; // 1 200 ₽ (20% скидка)

function referralLink(tgId: bigint): string {
  return `https://t.me/SverkaProBot?start=ref${tgId}`;
}

export async function handleSubscribe(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) {
    await ctx.reply(msg.accessExpired);
    return;
  }

  // Проверяем, первая ли это оплата (нет ни одной успешной транзакции) и приглашён ли пользователь
  const { findBillingTransactionsByUserId } = await import('@/src/db/repositories/billing-transactions');
  const txs = await findBillingTransactionsByUserId(user.id);
  const hasPaidBefore = txs.some((tx) => tx.status === 'SUCCESS');
  const isInvited = !!user.invited_by && !hasPaidBefore;

  const amountKopeks = isInvited ? DISCOUNT_PRICE_KOPEKS : FULL_PRICE_KOPEKS;
  const description = isInvited
    ? '30 дней полного доступа к сверке выплат Wildberries (скидка 20% за приглашение)'
    : '30 дней полного доступа к сверке выплат Wildberries';

  await ctx.replyWithInvoice({
    title: 'Подписка SverkaBot',
    description,
    payload: `sub_${user.id}_${Date.now()}`,
    provider_token: process.env.TELEGRAM_PROVIDER_TOKEN!,
    currency: 'RUB',
    prices: [{ label: isInvited ? 'Подписка на 30 дней (скидка 20%)' : 'Подписка на 30 дней', amount: amountKopeks }],
    need_email: true,
    send_email_to_provider: true,
    provider_data: {
      receipt: {
        items: [{
          description: 'Подписка SverkaBot 30 дней',
          quantity: '1.00',
          amount: {
            value: isInvited ? '1200.00' : '1500.00',
            currency: 'RUB',
          },
          vat_code: 1,
        }],
      },
    },
  });
}

export async function handleReferral(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) {
    await ctx.reply(msg.accessExpired);
    return;
  }

  const link = referralLink(BigInt(from.id));
  const invitedUsers = await findUsersByInvitedBy(BigInt(from.id));

  const message = [
    `🔗 Ваша реферальная ссылка:\n${link}`,
    '',
    `👥 Приглашено пользователей: ${invitedUsers.length}`,
    '',
    'За каждого друга, оплатившего подписку, вы получите +14 дней к своей подписке.',
    'Друзья получают скидку 20% на первый месяц.',
  ].join('\n');

  await ctx.reply(message);
}
