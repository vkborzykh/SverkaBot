import { NextRequest, NextResponse } from 'next/server';
import { errResponse } from '@/src/lib/http';

// X-Internal-Token guard — used by user-scoped endpoints called from the bot layer.
export function requireInternalToken(
  req: NextRequest,
): NextResponse | undefined {
  const token = req.headers.get('x-internal-token');
  const expected = process.env.INTERNAL_TOKEN;
  if (!expected || token !== expected) {
    return errResponse('UNAUTHORIZED', 'Missing or invalid X-Internal-Token', 401);
  }
}

// Bearer <ADMIN_TOKEN> guard — used by /api/admin/* endpoints.
export function requireAdminToken(req: NextRequest): NextResponse | undefined {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || token !== expected) {
    return errResponse('UNAUTHORIZED', 'Missing or invalid Admin token', 401);
  }
}

// X-Telegram-Bot-Api-Secret-Token guard — used by the Telegram webhook endpoint.
export function requireTelegramSecret(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return null; // если секрет не задан, пропускаем (для обратной совместимости)
  const header = req.headers.get('x-telegram-bot-api-secret-token');
  if (header !== secret) {
    return errResponse('UNAUTHORIZED', 'Invalid telegram secret', 401);
  }
  return null;
}
