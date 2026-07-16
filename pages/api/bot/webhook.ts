// pages/api/bot/webhook.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import type { Update, User as TgUser } from 'telegraf/types';
import { requireTelegramSecret } from '@/src/lib/guards';
import { okResponse, errResponse } from '@/src/lib/http';
import { findUserByTelegramId, updateUser } from '@/src/db/repositories/users';
import { drainQueue } from '@/src/lib/jobs/runner';
import { runBackground } from '@/src/lib/jobs/background';
import { getSession } from '@/src/lib/telegram/session';
import { msg } from '@/src/lib/telegram/messages.ru';
import { getMainMenuKeyboard } from '@/src/lib/telegram/keyboard';
import { checkAccess, PROTECTED_COMMANDS } from '@/src/lib/telegram/access';
import { TARIFF_BY_AMOUNT_KOPEKS } from '@/src/lib/billing/tariffs';
import { createBillingTransaction, findBillingTransactionByProviderTxId } from '@/src/db/repositories/billing-transactions';
import { getDb } from '@/src/db';
import { users } from '@/src/db/schema';
import { eq, sql, and, or, isNull, lt } from 'drizzle-orm';

// Простейший rate limiting для этапа A (только логирование)
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 10_000; // 10 секунд
const RATE_LIMIT_MAX = 20; // 20 запросов за окно

function checkRateLimit(telegramId: bigint): boolean {
  const key = String(telegramId);
  const now = Date.now();
  const timestamps = rateLimitMap.get(key) || [];
  const recent = timestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateLimitMap.set(key, recent);
  if (recent.length > RATE_LIMIT_MAX) {
    console.warn('[rate-limit] would block', { telegram_id: key, count: recent.length });
    return true; // превышен, но на этом этапе только логируем
  }
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, hint: 'telegram webhook endpoint (POST only)' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const guard = requireTelegramSecret(adaptToNextRequest(req) as any);
  if (guard) {
    return res.status(401).json({ error: 'Invalid telegram secret' });
  }

  let update: Update;
  try {
    update = req.body as Update;
  } catch (err) {
    console.error('[webhook] invalid JSON body:', err);
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  try {
    const updateId = (update as { update_id: number }).update_id;
    const from = extractFrom(update);
    const telegramId = from ? BigInt(from.id) : null;

    if (telegramId) {
      // Rate limiting shadow mode (только логирование)
      checkRateLimit(telegramId);

      const db = getDb();
      const result = await db
        .update(users)
        .set({ last_update_id: BigInt(updateId) })
        .where(
          and(
            eq(users.telegram_id, telegramId),
            or(
              isNull(users.last_update_id),
              lt(users.last_update_id, BigInt(updateId))
            )
          )
        );
      if (result.count === 0) {
        return res.status(200).json({ ok: true });
      }
    }

    // Маршрутизация команд и колбэков
    await routeTelegramUpdate(update);

  } catch (err) {
    console.error('[webhook] FATAL while processing update:', err);
  }

  runBackground(drainQueue());
  return res.status(200).json({ ok: true });
}

// ---------- Вспомогательные функции ----------

function extractFrom(update: Update): TgUser | undefined {
  if ('message' in update && update.message && 'from' in update.message) {
    return update.message.from;
  }
  if ('callback_query' in update && update.callback_query) {
    return update.callback_query.from;
  }
  return undefined;
}

function extractChatId(update: Update): number | undefined {
  if ('message' in update && update.message && 'chat' in update.message) {
    return update.message.chat.id;
  }
  if (
    'callback_query' in update &&
    update.callback_query &&
    'message' in update.callback_query &&
    update.callback_query.message &&
    'chat' in update.callback_query.message
  ) {
    return update.callback_query.message.chat.id;
  }
  return undefined;
}

function flattenExtra(extra: unknown): Record<string, unknown> {
  if (!extra || typeof extra !== 'object') return {};
  const e = extra as Record<string, unknown>;
  if ('reply_markup' in e) return { reply_markup: e.reply_markup };
  return e;
}

function buildContext(update: Update): any {
  const from = extractFrom(update);
  const chatId = extractChatId(update);
  const token = process.env.TELEGRAM_BOT_TOKEN;

  const sendText = async (text: string, extra?: unknown): Promise<unknown> => {
    if (!chatId || !token) return;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, ...flattenExtra(extra) }),
    });
    if (!res.ok) console.error('[webhook] sendMessage failed:', res.status, await res.text());
  };

  const cbQueryId =
    'callback_query' in update && update.callback_query
      ? update.callback_query.id
      : undefined;

  const messageId =
    'callback_query' in update &&
    update.callback_query &&
    'message' in update.callback_query &&
    update.callback_query.message
      ? update.callback_query.message.message_id
      : undefined;

  return {
    from,
    reply: sendText,
    answerCbQuery: async (text?: string) => {
      if (!cbQueryId || !token) return;
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: cbQueryId, text }),
      });
    },
    answerPreCheckoutQuery: async (query: any) => {
      if (!token) return;
      await fetch(`https://api.telegram.org/bot${token}/answerPreCheckoutQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pre_checkout_query_id: query.pre_checkout_query_id,
          ok: query.ok,
          error_message: query.error_message,
        }),
      });
    },
    replyWithInvoice: async (invoice: any, extra?: any) => {
      if (!chatId || !token) return;
      const body: Record<string, unknown> = { chat_id: chatId, ...invoice };
      if (extra) Object.assign(body, extra);
      await fetch(`https://api.telegram.org/bot${token}/sendInvoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    editMessageReplyMarkup: async (_markup: unknown) => {
      if (!chatId || !messageId || !token) return;
      await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {},
        }),
      });
    },
    message:
      'message' in update && update.message && 'text' in update.message
        ? { text: update.message.text }
        : undefined,
    callbackQuery:
      'callback_query' in update && update.callback_query
        ? { data: 'data' in update.callback_query ? update.callback_query.data : undefined }
        : undefined,
  };
}

const EXPECTED_PRICES: Record<string, { month: number; annual: number; monthWithReferral: number; annualWithReferral: number }> = {
  START: {
    month: 99_000,
    annual: Math.round(99_000 * 12 * 0.8),
    monthWithReferral: Math.round(99_000 * 0.8),
    annualWithReferral: Math.round(Math.round(99_000 * 12 * 0.8) * 0.8),
  },
  PRO: {
    month: 199_000,
    annual: Math.round(199_000 * 12 * 0.8),
    monthWithReferral: Math.round(199_000 * 0.8),
    annualWithReferral: Math.round(Math.round(199_000 * 12 * 0.8) * 0.8),
  },
  BUSINESS: {
    month: 499_000,
    annual: Math.round(499_000 * 12 * 0.8),
    monthWithReferral: Math.round(499_000 * 0.8),
    annualWithReferral: Math.round(Math.round(499_000 * 12 * 0.8) * 0.8),
  },
};

async function routeTelegramUpdate(update: Update): Promise<void> {
  const ctx = buildContext(update);
  const from = ctx.from;
  const chatId = extractChatId(update);
  const token = process.env.TELEGRAM_BOT_TOKEN;

  // Pre‑checkout
  if ('pre_checkout_query' in update && update.pre_checkout_query) {
    const pq = update.pre_checkout_query;
    const payload = pq.invoice_payload ?? '';
    const telegramId = BigInt(pq.from.id);

    if (payload.startsWith('addon_export_')) {
      const user = await findUserByTelegramId(telegramId);
      if (!user || (user.tariff !== 'PRO' && user.tariff !== 'START') || user.export_addon_active) {
        await ctx.answerPreCheckoutQuery({
          pre_checkout_query_id: pq.id,
          ok: false,
          error_message: 'Условия подключения аддона изменились. Пожалуйста, проверьте тариф.',
        });
        return;
      }
      await ctx.answerPreCheckoutQuery({ pre_checkout_query_id: pq.id, ok: true });
      return;
    }

    const isAnnual = payload.startsWith('annual_');
    const parts = isAnnual ? payload.replace('annual_', '').split('_') : payload.split('_');
    if (parts.length >= 3) {
      const tariffKey = parts[2];
      const days = isAnnual ? 365 : 30;
      const prices = EXPECTED_PRICES[tariffKey];
      if (prices) {
        const expectedAmount = days === 365 ? prices.annual : prices.month;
        const expectedWithReferral = days === 30 ? prices.monthWithReferral : prices.annualWithReferral;
        const isValidAmount =
          pq.total_amount === expectedAmount ||
          (expectedWithReferral !== null && pq.total_amount === expectedWithReferral);
        if (!isValidAmount) {
          await ctx.answerPreCheckoutQuery({
            pre_checkout_query_id: pq.id,
            ok: false,
            error_message: 'Сумма платежа не соответствует выбранному тарифу.',
          });
          return;
        }
      }
    }

    await ctx.answerPreCheckoutQuery({ pre_checkout_query_id: pq.id, ok: true });
    return;
  }

  // Successful payment
  if ('message' in update && update.message && 'successful_payment' in update.message) {
    const sp = update.message.successful_payment;
    const telegramId = BigInt(update.message.chat.id);

    if (sp.invoice_payload && sp.invoice_payload.startsWith('addon_export_')) {
      const EXPORT_ADDON_PRICE_KOPEKS = 59_000;
      if (sp.total_amount !== EXPORT_ADDON_PRICE_KOPEKS || sp.currency !== 'RUB') return;
      try {
        const existing = await findBillingTransactionByProviderTxId(sp.telegram_payment_charge_id);
        if (existing) return;

        const user = await findUserByTelegramId(telegramId);
        if (user && (user.tariff === 'PRO' || user.tariff === 'START')) {
          await updateUser(user.id, { export_addon_active: true });
          await createBillingTransaction({
            user_id: user.id,
            amount_kopeks: BigInt(sp.total_amount),
            currency: sp.currency,
            status: 'SUCCESS',
            provider: 'telegram',
            provider_tx_id: sp.telegram_payment_charge_id,
            confirmation_url: null,
          });
          await ctx.reply('🧩 Модуль «Экспорт для бухгалтера» подключён! Теперь вам доступен экспорт CSV/XLSX/1С на 30 дней.');
        }
      } catch (err) {
        console.error('[successful_payment] addon activation error:', err);
      }
      return;
    }

    try {
      const payload = sp.invoice_payload ?? '';
      let tariffKey: any = null;
      let days = 30;
      if (payload.startsWith('annual_')) {
        const parts = payload.replace('annual_', '').split('_');
        if (parts.length >= 3) { tariffKey = parts[2]; days = 365; }
      } else if (payload.startsWith('sub_')) {
        const parts = payload.split('_');
        if (parts.length >= 3) { tariffKey = parts[2]; }
      }

      if (!tariffKey || !['START', 'PRO', 'BUSINESS'].includes(tariffKey) || sp.currency !== 'RUB') return;

      const prices = EXPECTED_PRICES[tariffKey];
      const expectedAmount = days === 365 ? prices.annual : prices.month;
      const expectedWithReferral = days === 30 ? prices.monthWithReferral : prices.annualWithReferral;
      const isValidAmount =
        sp.total_amount === expectedAmount ||
        (expectedWithReferral !== null && sp.total_amount === expectedWithReferral);
      if (!isValidAmount) {
        console.error(`[successful_payment] amount mismatch: got ${sp.total_amount}, expected ${expectedAmount}`);
        return;
      }

      const user = await findUserByTelegramId(telegramId);
      if (user) {
        const existing = await findBillingTransactionByProviderTxId(sp.telegram_payment_charge_id);
        if (existing) return;

        const { activateSubscription } = await import('@/src/lib/billing/subscription');
        const endDate = await activateSubscription(user.id, days);
        await updateUser(user.id, { tariff: tariffKey, monthly_reconciliations: 0 });

        let referralBonusGranted = false;
        if (user.invited_by) {
          const referrer = await findUserByTelegramId(user.invited_by);
          if (referrer?.subscription_status === 'ACTIVE' && referrer.subscription_end_date) {
            const newEnd = new Date(referrer.subscription_end_date.getTime() + 14 * 24 * 60 * 60 * 1000);
            await updateUser(referrer.id, { subscription_end_date: newEnd });
            referralBonusGranted = true;
            if (token) {
              fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: String(user.invited_by), text: '🎉 Ваш друг оформил подписку! Вам начислено +14 дней.' }),
              }).catch(() => {});
            }
          }
        }

        await createBillingTransaction({
          user_id: user.id,
          amount_kopeks: BigInt(sp.total_amount),
          currency: sp.currency,
          status: 'SUCCESS',
          provider: 'telegram',
          provider_tx_id: sp.telegram_payment_charge_id,
          confirmation_url: null,
          referral_bonus_granted: referralBonusGranted,
        });

        const formatted = endDate.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', timeZone:'UTC' });
        let desc = '';
        if (tariffKey === 'START') desc = '🚀 Старт — до 8 сверок в месяц, HTML-отчёт, шаблон претензии.';
        else if (tariffKey === 'PRO') desc = '⚡️ Профи — безлимитные сверки, статистика, до 2 кабинетов WB.';
        else if (tariffKey === 'BUSINESS') desc = '💼 Бизнес — безлимитные сверки, до 5 кабинетов, экспорт (CSV/XLSX/1С), приоритетная обработка.';
        const periodText = days === 365 ? ' (год)' : '';
        await ctx.reply(`🎉 Оплата прошла успешно! Ваша подписка${periodText} активна до ${formatted}.\n\n${desc}\n\nПодробнее: /help`, getMainMenuKeyboard(tariffKey));
        await ctx.reply('Нажмите кнопку ниже, чтобы начать сверку.', {
          reply_markup: { inline_keyboard: [[{ text: '🆕 Начать новую сверку', callback_data: 'new_reconciliation' }]] }
        });
      }
    } catch (err) {
      console.error('[successful_payment] error:', err);
    }
    return;
  }

  if ('message' in update && update.message && 'text' in update.message && from) {
    const text = update.message.text.trim();
    const telegramId = BigInt(from.id);
    const sessionState = await getSession(telegramId);

    const commandMap: Record<string, string> = {
      [msg.menuNewReconciliation]: 'new_reconciliation',
      [msg.menuSubscribe]: 'subscribe',
      [msg.menuMyCabinets]: 'my_cabinets',
      [msg.menuHelp]: 'help',
      [msg.menuHistory]: 'history',
      [msg.menuStatistics]: 'statistics',
      [msg.menuDeleteData]: 'delete_my_data',
    };

    if (sessionState === 'awaiting_cabinet_name' && !text.startsWith('/') && !commandMap[text]) {
      const { handleCabinetNameReceived } = await import('@/src/lib/telegram/handlers/myCabinets');
      await handleCabinetNameReceived(ctx, text);
      return;
    }

    let command = '';
    if (text.startsWith('/')) {
      command = text.slice(1).split(' ')[0].toLowerCase();
    } else if (commandMap[text]) {
      command = commandMap[text];
    }
    if (!command) return;

    if (command === 'start') {
      const user = await findUserByTelegramId(telegramId);
      const { handleStart } = await import('@/src/lib/telegram/handlers/start');
      await handleStart(ctx);
      return;
    }

    const user = await findUserByTelegramId(telegramId);
    if (!user) {
      const { handleStart } = await import('@/src/lib/telegram/handlers/start');
      await handleStart(ctx);
      return;
    }

    // Явно извлекаем поля для checkAccess, чтобы избежать конфликта типов
    const access = checkAccess({
      subscription_status: user.subscription_status,
      trial_expires_at: user.trial_expires_at,
      subscription_end_date: user.subscription_end_date,
      telegram_id: user.telegram_id,
    });

    if (access !== 'full' && PROTECTED_COMMANDS.has(command)) {
      await ctx.reply(msg.accessExpired, {
        reply_markup: { inline_keyboard: [[{ text: '💰 Подписка', callback_data: 'subscribe_inline' }]] }
      });
      return;
    }

    switch (command) {
      case 'subscribe': {
        const { handleSubscribe } = await import('@/src/lib/telegram/handlers/subscribe');
        await handleSubscribe(ctx);
        break;
      }
      case 'referral': {
        const { handleReferral } = await import('@/src/lib/telegram/handlers/subscribe');
        await handleReferral(ctx);
        break;
      }
      case 'my_cabinets': {
        const { handleMyCabinets } = await import('@/src/lib/telegram/handlers/myCabinets');
        await handleMyCabinets(ctx);
        break;
      }
      case 'statistics': {
        const { handleStatistics } = await import('@/src/lib/telegram/handlers/dynamics');
        await handleStatistics(ctx);
        break;
      }
      case 'export': {
        const { handleExportCommand } = await import('@/src/lib/telegram/handlers/exportBusiness');
        await handleExportCommand(ctx);
        break;
      }
      case 'help': {
        const { handleHelp } = await import('@/src/lib/telegram/handlers/stubs');
        await handleHelp(ctx);
        break;
      }
      case 'history': {
        const { handleHistory } = await import('@/src/lib/telegram/handlers/history');
        await handleHistory(ctx);
        break;
      }
      case 'delete_my_data': {
        const { handleDeleteMyData } = await import('@/src/lib/telegram/handlers/deleteData');
        await handleDeleteMyData(ctx);
        break;
      }
      case 'get_report': {
        const { handleGetReport } = await import('@/src/lib/telegram/handlers/getReport');
        await handleGetReport(ctx);
        break;
      }
      case 'new_reconciliation': {
        const { handleNewReconciliation } = await import('@/src/lib/telegram/handlers/reconciliationFlow');
        await handleNewReconciliation(ctx, user.id);
        break;
      }
      default: break;
    }
  }

  if ('message' in update && update.message && 'document' in update.message && from) {
    const doc = update.message.document;
    const telegramId = BigInt(from.id);
    const sessionState = await getSession(telegramId);
    const docInfo = { fileId: doc.file_id, fileName: doc.file_name ?? 'file', fileSizeBytes: doc.file_size ?? 0 };

    // Если пользователь уже начал сверку, но ещё не выбрал кабинет,
    // напоминаем ему об этом и показываем список кабинетов.
    if (sessionState === 'choosing_cabinet') {
      const user = await findUserByTelegramId(telegramId);
      if (user) {
        const { findCabinetsByUserId } = await import('@/src/db/repositories/wb-cabinets');
        const cabinets = await findCabinetsByUserId(user.id);
        await ctx.reply(msg.cabinetMustBeSelected, {
          reply_markup: {
            inline_keyboard: cabinets.map((c) => [
              { text: `${c.id === user.current_cabinet_id ? '✅ ' : ''}${c.name}`, callback_data: `cabinet_pick:${c.id}` },
            ]),
          },
        });
      } else {
        await ctx.reply(msg.cabinetMustBeSelected);
      }
      return;
    }

    if (sessionState === 'awaiting_wb_file') {
      const { handleWbFileReceived } = await import('@/src/lib/telegram/handlers/upload');
      await handleWbFileReceived(ctx, docInfo);
    } else if (sessionState === 'awaiting_bank_file') {
      const { handleBankFileReceived } = await import('@/src/lib/telegram/handlers/upload');
      await handleBankFileReceived(ctx, docInfo);
    } else {
      await ctx.reply(msg.uploadNoSession);
    }
  }

  if ('callback_query' in update && update.callback_query) {
    const cbq = update.callback_query;
    const data = 'data' in cbq ? cbq.data : undefined;
    if (!data) return;

    if (data.startsWith('summary_period_pick:')) {
      const cabinetId = data.slice('summary_period_pick:'.length);
      const { handleSummaryPeriodPick } = await import('@/src/lib/telegram/handlers/summaryExport');
      await handleSummaryPeriodPick(ctx, cabinetId === 'all' ? undefined : cabinetId);
      return;
    }

    if (data.startsWith('summary_export:')) {
      const rest = data.slice('summary_export:'.length);
      const [cabinetIdPart, periodPart] = rest.split(':');
      const cabinetId = cabinetIdPart === 'all' ? undefined : cabinetIdPart;
      // Защита от произвольного значения периода в callback_data — падаем
      // обратно на 'all', а не доверяем строке напрямую.
      const validPeriods = ['week', 'month', 'prev_month', 'all'] as const;
      const period = (validPeriods as readonly string[]).includes(periodPart)
        ? (periodPart as (typeof validPeriods)[number])
        : 'all';
      const { handleSummaryExport } = await import('@/src/lib/telegram/handlers/summaryExport');
      await handleSummaryExport(ctx, cabinetId, period);
      return;
    }

    if (data.startsWith('tariff_choice:')) {
      const { handleTariffChoice } = await import('@/src/lib/telegram/handlers/subscribe');
      await handleTariffChoice(ctx, data.slice('tariff_choice:'.length));
      return;
    }
    if (data.startsWith('tariff_period:')) {
      const { handleTariffPeriod } = await import('@/src/lib/telegram/handlers/subscribe');
      const rest = data.slice('tariff_period:'.length);
      const [tariffKey, period] = rest.split(':');
      if (tariffKey && (period === 'month' || period === 'year')) {
        await handleTariffPeriod(ctx, tariffKey, period);
      }
      return;
    }
    if (data === 'tariff_export_addon') {
      const { handleExportAddon } = await import('@/src/lib/telegram/handlers/subscribe');
      await handleExportAddon(ctx);
      return;
    }

    if (data.startsWith('claim_text:')) {
      const { handleClaimText } = await import('@/src/lib/telegram/handlers/claim');
      await handleClaimText(ctx, data.slice('claim_text:'.length));
      return;
    }

    if (data.startsWith('cabinet_del:')) {
      const { handleCabinetDelete } = await import('@/src/lib/telegram/handlers/myCabinets');
      await handleCabinetDelete(ctx, data.slice('cabinet_del:'.length));
      return;
    }
    if (data.startsWith('cabinet_pick:')) {
      const { handleCabinetPick } = await import('@/src/lib/telegram/handlers/reconciliationFlow');
      await handleCabinetPick(ctx, data.slice('cabinet_pick:'.length));
      return;
    }
    if (data.startsWith('cabinet_use:')) {
      const { handleCabinetUse } = await import('@/src/lib/telegram/handlers/myCabinets');
      await handleCabinetUse(ctx, data.slice('cabinet_use:'.length));
      return;
    }
    if (data.startsWith('statistics_cabinet:')) {
      const { handleStatisticsFilter } = await import('@/src/lib/telegram/handlers/dynamics');
      await handleStatisticsFilter(ctx, data.slice('statistics_cabinet:'.length));
      return;
    }
    if (data === 'statistics_all') {
      const { handleStatisticsFilter } = await import('@/src/lib/telegram/handlers/dynamics');
      await handleStatisticsFilter(ctx, 'all');
      return;
    }

    if (data.startsWith('history_report:')) {
      const { handleHistoryReport } = await import('@/src/lib/telegram/handlers/history');
      await handleHistoryReport(ctx, data.slice('history_report:'.length));
      return;
    }
    if (data.startsWith('history_html:')) {
      const { handleHistoryHtml } = await import('@/src/lib/telegram/handlers/history');
      await handleHistoryHtml(ctx, data.slice('history_html:'.length));
      return;
    }
    if (data.startsWith('download_wb:')) {
      const { handleDownloadWb } = await import('@/src/lib/telegram/handlers/history');
      await handleDownloadWb(ctx, data.slice('download_wb:'.length));
      return;
    }
    if (data.startsWith('download_bank:')) {
      const { handleDownloadBank } = await import('@/src/lib/telegram/handlers/history');
      await handleDownloadBank(ctx, data.slice('download_bank:'.length));
      return;
    }
    if (data.startsWith('export_menu:')) {
      const { handleExportMenu } = await import('@/src/lib/telegram/handlers/history');
      await handleExportMenu(ctx, data.slice('export_menu:'.length));
      return;
    }
    if (data.startsWith('export_csv:')) {
      const { handleExportCsv } = await import('@/src/lib/telegram/handlers/exportBusiness');
      await handleExportCsv(ctx, data.slice('export_csv:'.length));
      return;
    }
    if (data.startsWith('export_xlsx:')) {
      const { handleExportXlsx } = await import('@/src/lib/telegram/handlers/exportBusiness');
      await handleExportXlsx(ctx, data.slice('export_xlsx:'.length));
      return;
    }
    if (data.startsWith('export_1c:')) {
      const { handleExport1c } = await import('@/src/lib/telegram/handlers/exportBusiness');
      await handleExport1c(ctx, data.slice('export_1c:'.length));
      return;
    }

    switch (data) {
      case 'cabinet_add': {
        const { handleCabinetAdd } = await import('@/src/lib/telegram/handlers/myCabinets');
        await handleCabinetAdd(ctx);
        break;
      }
      case 'my_cabinets': {
        const { handleMyCabinets } = await import('@/src/lib/telegram/handlers/myCabinets');
        await handleMyCabinets(ctx);
        break;
      }
      case 'consent:accept': {
        const { handleConsentAccept } = await import('@/src/lib/telegram/handlers/start');
        await handleConsentAccept(ctx);
        break;
      }
      case 'consent:decline': {
        const { handleConsentDecline } = await import('@/src/lib/telegram/handlers/start');
        await handleConsentDecline(ctx);
        break;
      }
      case 'delete:confirm': {
        const { handleDeleteConfirm } = await import('@/src/lib/telegram/handlers/deleteData');
        await handleDeleteConfirm(ctx);
        break;
      }
      case 'delete:cancel': {
        const { handleDeleteCancel } = await import('@/src/lib/telegram/handlers/deleteData');
        await handleDeleteCancel(ctx);
        break;
      }
      case 'new_reconciliation': {
        const user = await findUserByTelegramId(BigInt(from!.id));
        if (user) {
          const { handleNewReconciliation } = await import('@/src/lib/telegram/handlers/reconciliationFlow');
          await handleNewReconciliation(ctx, user.id);
        }
        break;
      }
      case 'upload_wb_inline': {
        const { handleUploadWbInline } = await import('@/src/lib/telegram/handlers/reconciliationFlow');
        await handleUploadWbInline(ctx);
        break;
      }
      case 'replace_wb': {
        const { handleReplaceWb } = await import('@/src/lib/telegram/handlers/reconciliationFlow');
        await handleReplaceWb(ctx);
        break;
      }
      case 'upload_bank_inline': {
        const { handleUploadBankInline } = await import('@/src/lib/telegram/handlers/reconciliationFlow');
        await handleUploadBankInline(ctx);
        break;
      }
      case 'replace_bank': {
        const { handleReplaceBank } = await import('@/src/lib/telegram/handlers/reconciliationFlow');
        await handleReplaceBank(ctx);
        break;
      }
      case 'run_sync_inline': {
        const { handleRunSyncInline } = await import('@/src/lib/telegram/handlers/reconciliationFlow');
        await handleRunSyncInline(ctx);
        break;
      }
      case 'subscribe_inline': {
        const { handleSubscribe } = await import('@/src/lib/telegram/handlers/subscribe');
        await handleSubscribe(ctx);
        break;
      }
    }
  }
}

function adaptToNextRequest(req: NextApiRequest): any {
  return {
    headers: {
      get: (name: string) => req.headers[name.toLowerCase()] as string | undefined,
    },
  };
}
