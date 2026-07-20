import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { errResponse } from '@/src/lib/http';

// Утилита для timing-safe сравнения строк
function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// X-Internal-Token guard — used by user-scoped endpoints called from the bot layer.
export function requireInternalToken(
  req: NextRequest,
): NextResponse | undefined {
  const token = req.headers.get('x-internal-token');
  const expected = process.env.INTERNAL_TOKEN;
  if (!expected || !token || !timingSafeEqualStr(token, expected)) {
    return errResponse('UNAUTHORIZED', 'Missing or invalid X-Internal-Token', 401);
  }
}

// Bearer <ADMIN_TOKEN> guard — used by /api/admin/* endpoints.
export function requireAdminToken(req: NextRequest): NextResponse | undefined {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !token || !timingSafeEqualStr(token, expected)) {
    return errResponse('UNAUTHORIZED', 'Missing or invalid Admin token', 401);
  }
}

// X-Telegram-Bot-Api-Secret-Token guard — used by the Telegram webhook endpoint.
export function requireTelegramSecret(req: NextRequest): NextResponse | undefined {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  // Fail-closed: если секрет не задан, запросы от Telegram НЕ принимаются
  if (!secret) {
    return errResponse('UNAUTHORIZED', 'Webhook secret not configured', 401);
  }
  const header = req.headers.get('x-telegram-bot-api-secret-token');
  if (!header || !timingSafeEqualStr(header, secret)) {
    return errResponse('UNAUTHORIZED', 'Invalid telegram secret', 401);
  }
}
