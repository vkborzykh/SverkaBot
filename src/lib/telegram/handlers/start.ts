import type { Context } from 'telegraf';
import { findUserByTelegramId, createUser } from '@/src/db/repositories/users';
import { createConsent } from '@/src/db/repositories/consents';
import { logAuditEvent } from '@/src/lib/audit/audit';
import { hasUsedTrial, markTrialUsed } from '@/src/db/repositories/trial-usage';
import { consentKeyboard, mainMenuKeyboard, newReconciliationKeyboard } from '../keyboard';
import { msg } from '../messages.ru';

export async function handleStart(ctx: Context): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);

  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const refId = text.startsWith('/start ') ? text.slice(7).trim() : null;

  const existing = await findUserByTelegramId(telegramId);

  if (existing) {
    if (existing.subscription_status === 'EXPIRED') {
      await ctx.reply(msg.accessExpired, {
        reply_markup: {
          inline_keyboard: [[{ text: '💰 Подписка', callback_data: 'subscribe_inline' }]],
        },
      });
    } else {
      await ctx.reply(
        msg.consentAccepted(
          formatDate(
            existing.trial_expires_at ??
              existing.subscription_end_date ??
              new Date(),
          ),
        ),
        mainMenuKeyboard,
      );
    }
    await ctx.reply('Нажмите кнопку ниже, чтобы начать сверку.', newReconciliationKeyboard);
    return;
  }

  await ctx.reply(msg.welcome, consentKeyboard);
  if (refId) {
    const { setSession } = await import('@/src/lib/telegram/session');
    await setSession(telegramId, 'awaiting_consent', { ref: refId });
  }
}

export async function handleConsentAccept(ctx: Context): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);

  const existing = await findUserByTelegramId(telegramId);
  if (existing) {
    await ctx.answerCbQuery();
    await ctx.reply(
      msg.consentAccepted(
        formatDate(
          existing.trial_expires_at ??
            existing.subscription_end_date ??
            new Date(),
        ),
      ),
      mainMenuKeyboard,
    );
    await ctx.reply('Нажмите кнопку ниже, чтобы начать сверку.', newReconciliationKeyboard);
    return;
  }

  const usedTrial = await hasUsedTrial(telegramId);

  if (usedTrial) {
    const past = new Date();
    const user = await createUser({
      telegram_id: telegramId,
      username: ctx.from!.username ?? null,
      subscription_status: 'EXPIRED',
      trial_expires_at: past,
      has_used_trial: true,
      consent_given_at: new Date(),
    });
    await createConsent({ user_id: user.id, consent_version: '1.0', accepted_at: new Date() });
    await logAuditEvent(user.id, 'consent_accepted');
    await logAuditEvent(user.id, 'trial_denied_reused');
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(msg.trialAlreadyUsed, mainMenuKeyboard);
    return;
  }

  const { getSession, clearSession } = await import('@/src/lib/telegram/session');
  const sessionData = await getSession(telegramId) as any;
  const refId = sessionData?.ref;

  const trialExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const user = await createUser({
    telegram_id: telegramId,
    username: ctx.from!.username ?? null,
    subscription_status: 'TRIAL',
    trial_expires_at: trialExpiresAt,
    has_used_trial: true,
    invited_by: refId ? BigInt(refId) : null,
    consent_given_at: new Date(),
  });

  await markTrialUsed(telegramId);
  if (sessionData) await clearSession(telegramId);

  await createConsent({ user_id: user.id, consent_version: '1.0', accepted_at: new Date() });
  await logAuditEvent(user.id, 'consent_accepted');
  await logAuditEvent(user.id, 'trial_started', { trial_expires_at: trialExpiresAt.toISOString() });

  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply(msg.consentAccepted(formatDate(trialExpiresAt)), mainMenuKeyboard);
  await ctx.reply('Нажмите кнопку ниже, чтобы начать сверку.', newReconciliationKeyboard);
}

export async function handleConsentDecline(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  await ctx.reply(msg.consentDeclined);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
