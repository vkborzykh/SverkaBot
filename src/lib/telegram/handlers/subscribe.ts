import type { Context } from 'telegraf';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { msg } from '../messages.ru';

const SUBSCRIPTION_AMOUNT_KOPEKS = 150000; // 1 500,00 ₽

export async function handleSubscribe(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) {
    await ctx.reply(msg.accessExpired);
    return;
  }

  await ctx.replyWithInvoice({
    title: 'Подписка SverkaBot',
    description: '30 дней полного доступа к сверке выплат Wildberries',
    payload: `sub_${user.id}_${Date.now()}`,
    provider_token: process.env.TELEGRAM_PROVIDER_TOKEN!,
    currency: 'RUB',
    prices: [{ label: 'Оплатить подписку', amount: SUBSCRIPTION_AMOUNT_KOPEKS }],
    need_email: true,
    send_email_to_provider: true,
    provider_data: {
      receipt: {
        items: [{
          description: 'Подписка SverkaBot 30 дней',
          quantity: '1.00',
          amount: {
            value: '1500.00',
            currency: 'RUB',
          },
          vat_code: 1,
        }],
      },
    },
  });
}
