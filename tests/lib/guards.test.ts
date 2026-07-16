import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  requireInternalToken,
  requireAdminToken,
  requireTelegramSecret,
} from '@/src/lib/guards';

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  const req = new NextRequest('http://localhost/api/test');
  Object.entries(headers).forEach(([k, v]) => req.headers.set(k, v));
  return req;
}

describe('requireInternalToken', () => {
  beforeEach(() => {
    process.env.INTERNAL_TOKEN = 'secret-internal';
  });

  it('returns 401 when header is missing', async () => {
    const res = requireInternalToken(makeRequest());
    expect(res).toBeDefined();
    expect(res!.status).toBe(401);
    const body = await res!.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when token is wrong', async () => {
    const res = requireInternalToken(
      makeRequest({ 'x-internal-token': 'wrong' }),
    );
    expect(res).toBeDefined();
    expect(res!.status).toBe(401);
  });

  it('returns undefined (pass) when token is correct', () => {
    const res = requireInternalToken(
      makeRequest({ 'x-internal-token': 'secret-internal' }),
    );
    expect(res).toBeUndefined();
  });
});

describe('requireAdminToken', () => {
  beforeEach(() => {
    process.env.ADMIN_TOKEN = 'admin-secret';
  });

  it('returns 401 when header is missing', async () => {
    const res = requireAdminToken(makeRequest());
    expect(res).toBeDefined();
    expect(res!.status).toBe(401);
  });

  it('returns undefined when Bearer token is correct', () => {
    const res = requireAdminToken(
      makeRequest({ authorization: 'Bearer admin-secret' }),
    );
    expect(res).toBeUndefined();
  });
});

describe('requireTelegramSecret', () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'tg-secret';
  });

  it('returns 401 when header is missing', async () => {
    const res = requireTelegramSecret(makeRequest());
    expect(res).toBeDefined();
    expect(res!.status).toBe(401);
  });

  it('returns undefined when secret matches', () => {
    const res = requireTelegramSecret(
      makeRequest({ 'x-telegram-bot-api-secret-token': 'tg-secret' }),
    );
    expect(res).toBeUndefined();
  });
});
