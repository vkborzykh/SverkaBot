import type { Context } from 'telegraf';
import { findUserByTelegramId, updateUser, findUsersByInvitedBy } from '@/src/db/repositories/users';
import { msg } from '../messages.ru';

const TARIFFS = {
  START: { priceKopeks: 99000, label: '🚀 Старт', desc: '30 дней, до 4 сверок в месяц' },
  PRO: { priceKopeks: 199000, label: '⚡ Профи', desc: '30 дней, безлимит, Google Sheets, Динамика, приоритет' },
  BUSINESS: { priceKopeks: 499000, label: '💼 Бизнес', desc: '30 дней, до 5 кабинетов, CSV, хранение 365 дней' },
};

export async function handleSubscribe(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) {
    await ctx.reply(msg.accessExpired);
    return;
  }

  await ctx.reply('Выберите тариф:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: `${TARIFFS.START.label} — 990 ₽/мес (4 сверки)`, callback_data: 'tariff_start' }],
        [{ text: `${TARIFFS.PRO.label} — 1 990 ₽/мес (безлимит)`, callback_data: 'tariff_pro' }],
        [{ text: `${TARIFFS.BUSINESS.label} — 4 990 ₽/мес (до 5 кабинетов)`, callback_data: 'tariff_business' }],
      ],
    },
  });
}

async function sendInvoice(ctx: Context, userId: string, tariffKey: keyof typeof TARIFFS) {
  const t = TARIFFS[tariffKey];
  await ctx.replyWithInvoice({
    title: `Подписка SverkaBot — ${t.label}`,
    description: t.desc,
    payload: `sub_${userId}_${tariffKey}_${Date.now()}`,
    provider_token: process.env.TELEGRAM_PROVIDER_TOKEN!,
    currency: 'RUB',
    prices: [{ label: t.label, amount: t.priceKopeks }],
    need_email: true,
    send_email_to_provider: true,
    provider_data: {
      receipt: {
        items: [{
          description: `Подписка SverkaBot ${t.label}`,
          quantity: '1.00',
          amount: { value: (t.priceKopeks / 100).toFixed(2), currency: 'RUB' },
          vat_code: 1,
        }],
      },
    },
  });
}

export async function handleTariffStart(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;
  await updateUser(user.id, { tariff: 'START' });
  await sendInvoice(ctx, user.id, 'START');
}

export async function handleTariffPro(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;
  await updateUser(user.id, { tariff: 'PRO' });
  await sendInvoice(ctx, user.id, 'PRO');
}

export async function handleTariffBusiness(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;
  await updateUser(user.id, { tariff: 'BUSINESS' });
  await sendInvoice(ctx, user.id, 'BUSINESS');
}

export async function handleReferral(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) {
    await ctx.reply(msg.accessExpired);
    return;
  }

  const link = `https://t.me/SverkaProBot?start=ref${BigInt(from.id)}`;
  const invitedUsers = await findUsersByInvitedBy(BigInt(from.id));

  await ctx.reply([
    `🔗 Ваша реферальная ссылка:\n${link}`,
    '',
    `👥 Приглашено пользователей: ${invitedUsers.length}`,
    '',
    'За каждого друга, оплатившего подписку, вы получите +14 дней к своей подписке.',
    'Друзья получают скидку 20% на первый месяц.',
  ].join('\n'));
}
