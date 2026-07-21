// src/lib/telegram/handlers/subscribe.ts
import type { Context } from 'telegraf';
import { findUserByTelegramId, findUserById, updateUser, findUsersByInvitedBy } from '@/src/db/repositories/users';
import { msg } from '../messages.ru';
import { EXPORT_ADDON_PRICE_KOPEKS, TARIFF_PRICES_KOPEKS } from '@/src/lib/billing/tariffs';
import type { Tariff } from '@/src/lib/billing/tariffs';

const TARIFFS: Record<Tariff, { priceKopeks: number; annualPriceKopeks: number; label: string; descMonth: string; descYear: string }> = {
  START: {
    priceKopeks: 99_000,
    annualPriceKopeks: Math.round(99_000 * 12 * 0.8),
    label: '🚀 Старт',
    descMonth: '30 дней, до 8 сверок в месяц',
    descYear: '365 дней, до 8 сверок каждый месяц',
  },
  PRO: {
    priceKopeks: 199_000,
    annualPriceKopeks: Math.round(199_000 * 12 * 0.8),
    label: '⚡ Профи',
    descMonth: '30 дней, безлимит, Статистика, до 2 кабинетов',
    descYear: '365 дней, безлимит, статистика, до 2 кабинетов',
  },
  BUSINESS: {
    priceKopeks: 499_000,
    annualPriceKopeks: Math.round(499_000 * 12 * 0.8),
    label: '💼 Бизнес',
    descMonth: '30 дней, до 5 кабинетов, экспорт (CSV/XLSX/1С), хранение 365 дней',
    descYear: '365 дней, статистика, до 5 кабинетов, экспорт (CSV/XLSX/1С), хранение в течение года',
  },
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

  // Формируем кнопки с реальными годовыми ценами (скидка 20% от 12 месяцев)
  const keyboard: { text: string; callback_data: string }[][] = [
    [{ text: `${TARIFFS.START.label} – 990 ₽/мес (${Math.round(TARIFFS.START.annualPriceKopeks / 100)} ₽/год)`, callback_data: 'tariff_choice:START' }],
    [{ text: `${TARIFFS.PRO.label} – 1 990 ₽/мес (${Math.round(TARIFFS.PRO.annualPriceKopeks / 100)} ₽/год)`, callback_data: 'tariff_choice:PRO' }],
    [{ text: `${TARIFFS.BUSINESS.label} – 4 990 ₽/мес (${Math.round(TARIFFS.BUSINESS.annualPriceKopeks / 100)} ₽/год)`, callback_data: 'tariff_choice:BUSINESS' }],
  ];

  if (user.tariff === 'PRO' && !user.export_addon_active) {
    keyboard.push([{ text: '🧩 Экспорт для бухгалтера – 590 ₽/мес', callback_data: 'tariff_export_addon' }]);
  }

  if (user.tariff === 'START' && !user.export_addon_active) {
    keyboard.push([{ text: '🧩 Экспорт для бухгалтера – 590 ₽/мес', callback_data: 'tariff_export_addon' }]);
  }

  await ctx.reply(msg.chooseTariffPrompt, {
    reply_markup: { inline_keyboard: keyboard },
  });
}

export async function handleTariffChoice(ctx: Context, tariffKey: string): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;

  const t = TARIFFS[tariffKey as Tariff];
  if (!t) return;

  const monthPrice = (t.priceKopeks / 100).toFixed(0);
  const yearPrice = (t.annualPriceKopeks / 100).toFixed(0);
  const monthEconomy = ((t.priceKopeks * 12 - t.annualPriceKopeks) / 100).toFixed(0);

  await ctx.answerCbQuery();
  await ctx.reply(
    `Вы выбрали тариф «${t.label}».\nВыберите период подписки:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: `📅 Месяц – ${monthPrice} ₽`, callback_data: `tariff_period:${tariffKey}:month` }],
          [{ text: `📆 Год – ${yearPrice} ₽ (экономия ${monthEconomy} ₽)`, callback_data: `tariff_period:${tariffKey}:year` }],
        ],
      },
    },
  );
}

export async function handleTariffPeriod(ctx: Context, tariffKey: string, period: 'month' | 'year'): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;

  const t = TARIFFS[tariffKey as Tariff];
  if (!t) return;

  const days = period === 'year' ? 365 : 30;
  const amount = period === 'year' ? t.annualPriceKopeks : t.priceKopeks;

  await ctx.answerCbQuery();
  await sendInvoiceForPeriod(ctx, user.id, tariffKey as Tariff, days, amount);
}

async function sendInvoiceForPeriod(ctx: Context, userId: string, tariffKey: Tariff, days: number, priceKopeks: number) {
  const t = TARIFFS[tariffKey];
  let finalPrice = priceKopeks;

  // Реферальная скидка 20% для любой подписки (месяц/год)
  try {
    const currentUser = await findUserById(userId);
    if (currentUser && currentUser.invited_by) {
      const inviter = await findUserByTelegramId(currentUser.invited_by);
      if (inviter && inviter.subscription_status === 'ACTIVE') {
        finalPrice = Math.round(priceKopeks * 0.8);
      }
    }
  } catch (e) {
    console.error('Referral discount check failed:', e);
  }

  const periodLabel = days === 365 ? '(год)' : '(месяц)';
  const desc = days === 365 ? t.descYear : t.descMonth;
  const payload = `${days === 365 ? 'annual_' : ''}sub_${userId}_${tariffKey}_${Date.now()}`;

  await ctx.replyWithInvoice({
    title: `Подписка SverkaBot – ${t.label} ${periodLabel}`,
    description: desc,
    payload,
    provider_token: process.env.TELEGRAM_PROVIDER_TOKEN!,
    currency: 'RUB',
    prices: [{ label: t.label, amount: finalPrice }],
    need_email: true,
    send_email_to_provider: true,
    provider_data: JSON.stringify({
      receipt: {
        items: [{
          description: `Подписка SverkaBot ${t.label} ${periodLabel}`,
          quantity: '1.00',
          amount: { value: (finalPrice / 100).toFixed(2), currency: 'RUB' },
          vat_code: 1,
        }],
      },
    }),
  });
}

async function sendExportAddonInvoice(ctx: Context, userId: string) {
  await ctx.replyWithInvoice({
    title: 'SverkaBot – Экспорт для бухгалтера',
    description: 'Дополнительный модуль экспорта CSV/XLSX/1С на 30 дней (для тарифов Старт и Профи)',
    payload: `addon_export_${userId}_${Date.now()}`,
    provider_token: process.env.TELEGRAM_PROVIDER_TOKEN!,
    currency: 'RUB',
    prices: [{ label: 'Экспорт для бухгалтера', amount: EXPORT_ADDON_PRICE_KOPEKS }],
    need_email: true,
    send_email_to_provider: true,
    provider_data: JSON.stringify({
      receipt: {
        items: [{
          description: 'Экспорт для бухгалтера',
          quantity: '1.00',
          amount: { value: (EXPORT_ADDON_PRICE_KOPEKS / 100).toFixed(2), currency: 'RUB' },
          vat_code: 1,
        }],
      },
    }),
  });
}

export async function handleExportAddon(ctx: Context): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;
  if (user.tariff !== 'PRO' && user.tariff !== 'START') {
    await ctx.answerCbQuery('Аддон доступен на тарифах Старт и Профи', { show_alert: true });
    return;
  }
  if (user.export_addon_active) {
    await ctx.answerCbQuery('У вас уже подключён экспорт', { show_alert: true });
    return;
  }
  await ctx.answerCbQuery();
  await sendExportAddonInvoice(ctx, user.id);
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

  const canEarnBonus = user.subscription_status === 'ACTIVE';

  const lines = [
    `🔗 Ваша реферальная ссылка:\n${link}`,
    '',
    `👥 Приглашено пользователей: ${invitedUsers.length}`,
  ];

  if (canEarnBonus) {
    lines.push('💎 За каждого друга, оплатившего подписку, вы получите +14 дней к своей подписке.');
    lines.push('Друзья получают скидку 20% на первую оплату (месяц или год).');
  } else {
    lines.push('⚠️ Бонусные дни начисляются только при активной платной подписке.');
    lines.push('Оформите подписку, чтобы получать +14 дней за каждого друга.');
    lines.push('Друзья получат скидку 20% на первую оплату в любом случае.');
  }

  await ctx.reply(lines.join('\n'));
}
