// src/lib/telegram/handlers/subscribe.ts
import type { Context } from 'telegraf';
import { findUserByTelegramId, updateUser, findUsersByInvitedBy } from '@/src/db/repositories/users';
import { msg } from '../messages.ru';

const TARIFFS = {
  START: { priceKopeks: 99000, label: '🚀 Старт', desc: '30 дней, до 8 сверок в месяц' },
  PRO:   { priceKopeks: 199000, label: '⚡ Профи', desc: '30 дней, безлимит, Статистика, до 2 кабинетов' },
  BUSINESS: { priceKopeks: 499000, label: '💼 Бизнес', desc: '30 дней, до 5 кабинетов, экспорт (CSV/XLSX/1С), хранение 365 дней' },
};

function formatDate(date: Date): string {
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
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

  // Формируем сообщение о текущем статусе
  let statusText: string;
  const now = new Date();
  if (user.subscription_status === 'TRIAL' && user.trial_expires_at) {
    const trialEnd = new Date(user.trial_expires_at);
    if (trialEnd > now) {
      statusText = msg.subscriptionStatusTrialActive(formatDate(trialEnd));
    } else {
      statusText = msg.subscriptionStatusTrialExpired;
    }
  } else if (user.subscription_status === 'ACTIVE' && user.subscription_end_date) {
    const endDate = new Date(user.subscription_end_date);
    const formatted = formatDate(endDate);
    switch (user.tariff) {
      case 'START':
        statusText = msg.subscriptionStatusTariffStart(formatted);
        break;
      case 'PRO':
        statusText = msg.subscriptionStatusTariffPro(formatted);
        break;
      case 'BUSINESS':
        statusText = msg.subscriptionStatusTariffBusiness(formatted);
        break;
      default:
        statusText = 'Текущий статус: активна подписка.';
    }
  } else {
    statusText = 'Текущий статус: нет активной подписки.';
  }

  await ctx.reply(statusText);
  await ctx.reply(msg.chooseTariffPrompt, {
    reply_markup: {
      inline_keyboard: [
        [{ text: `${TARIFFS.START.label} — 990 ₽/мес (8 сверок)`, callback_data: 'tariff_start' }],
        [{ text: `${TARIFFS.PRO.label} — 1 990 ₽/мес (безлимит)`, callback_data: 'tariff_pro' }],
        [{ text: `${TARIFFS.BUSINESS.label} — 4 990 ₽/мес (до 5 кабинетов, экспорт)`, callback_data: 'tariff_business' }],
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
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;
  if (user.tariff === 'START') {
    await ctx.answerCbQuery(msg.tariffAlreadyActive, { show_alert: true });
    return;
  }
  await ctx.answerCbQuery();
  await sendInvoice(ctx, user.id, 'START');
}

export async function handleTariffPro(ctx: Context): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;
  if (user.tariff === 'PRO') {
    await ctx.answerCbQuery(msg.tariffAlreadyActive, { show_alert: true });
    return;
  }
  await ctx.answerCbQuery();
  await sendInvoice(ctx, user.id, 'PRO');
}

export async function handleTariffBusiness(ctx: Context): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;
  if (user.tariff === 'BUSINESS') {
    await ctx.answerCbQuery(msg.tariffAlreadyActive, { show_alert: true });
    return;
  }
  await ctx.answerCbQuery();
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
