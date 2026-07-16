// src/lib/security/telegramWebApp.ts
import crypto from 'crypto';

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60; // 24 часа

export interface TelegramWebAppUser {
  id: number;
  username?: string;
  first_name?: string;
}

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
): { ok: true; user: TelegramWebAppUser } | { ok: false; reason: string } {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no_hash' };
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // timingSafeEqual бросает исключение при несовпадении длины буферов.
  // Проверяем длину до сравнения и оборачиваем в try/catch.
  const computedBuffer = Buffer.from(computedHash);
  const hashBuffer = Buffer.from(hash);
  if (computedBuffer.length !== hashBuffer.length) {
    return { ok: false, reason: 'bad_signature' };
  }
  try {
    if (!crypto.timingSafeEqual(computedBuffer, hashBuffer)) {
      return { ok: false, reason: 'bad_signature' };
    }
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) {
    return { ok: false, reason: 'expired' };
  }

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, reason: 'no_user' };
  
  try {
    const user = JSON.parse(userRaw) as TelegramWebAppUser;
    return { ok: true, user };
  } catch {
    return { ok: false, reason: 'invalid_user_json' };
  }
}
