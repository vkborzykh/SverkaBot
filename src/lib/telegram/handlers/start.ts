import type { Context } from 'telegraf';
import { findUserByTelegramId, createUser } from '@/src/db/repositories/users';
import { createConsent } from '@/src/db/repositories/consents';
import { logAuditEvent } from '@/src/lib/audit/audit';
import { consentKeyboard, mainMenuKeyboard } from '../keyboard';
import { msg } from '../messages.ru';

export async function handleStart(ctx: Context): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);
  const existing = await findUserByTelegramId(telegramId);

  if (existing) {
    await ctx.reply(msg.consentAccepted(formatDate(existing.trial_expires_at ?? existing.subscription_end_date ?? new Date())), mainMenuKeyboard);
    return;
  }

  await ctx.reply(msg.welcome, consentKeyboard);
}

export async function handleConsentAccept(ctx: Context): Promise<void> {
  const telegramId = BigInt(ctx.from!.id);

  // Guard against duplicate processing
  const existing = await findUserByTelegramId(telegramId);
  if (existing) {
    await ctx.answerCbQuery();
    await ctx.reply(msg.consentAccepted(formatDate(existing.trial_expires_at!)), mainMenuKeyboard);
    return;
  }

  const trialExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const user = await createUser({
    telegram_id: telegramId,
    username: ctx.from!.username ?? null,
    subscription_status: 'TRIAL',
    trial_expires_at: trialExpiresAt,
    consent_given_at: new Date(),
  });

  await createConsent({
    user_id: user.id,
    consent_version: '1.0',
    accepted_at: new Date(),
  });

  await logAuditEvent(user.id, 'consent_accepted');
  await logAuditEvent(user.id, 'trial_started', {
    trial_expires_at: trialExpiresAt.toISOString(),
  });

  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply(msg.consentAccepted(formatDate(trialExpiresAt)), mainMenuKeyboard);
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
