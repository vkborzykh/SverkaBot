import type { Context } from 'telegraf';
import { findUserByTelegramId } from '@/src/db/repositories/users';

export async function handleSubscribe(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) {
    await ctx.reply('Пользователь не найден.');
    return;
  }

  const token = process.env.TELEGRAM_PROVIDER_TOKEN;
  if (!token) {
    await ctx.reply('Ошибка: платёжный токен не задан.');
    return;
  }

  await ctx.replyWithInvoice({
    title: 'Подписка SverkaBot',
    description: '30 дней полного доступа к сверке выплат Wildberries',
    payload: `sub_${user.id}_${Date.now()}`,
    provider_token: token,
    currency: 'RUB',
    prices: [{ label: 'Подписка на 30 дней', amount: 150000 }],
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
