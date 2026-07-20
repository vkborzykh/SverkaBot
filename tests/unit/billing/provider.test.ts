import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { YooKassaProvider, getPaymentProvider } from '@/src/lib/billing/provider';

// MockPaymentProvider больше не существует — удалён при закрытии аудита
// безопасности (незащищённый mock-payment). Тестируем реальный провайдер.

describe('YooKassaProvider', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv('YOOKASSA_SHOP_ID', 'shop-123');
    vi.stubEnv('YOOKASSA_SECRET_KEY', 'secret-abc');
    vi.stubEnv('YOOKASSA_RETURN_URL', 'https://sverkabot.example/return');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
  });

  describe('createPayment', () => {
    it('sends amount in rubles (kopeks / 100) and returns paymentUrl/providerTxId from the response', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'yk_12345',
          confirmation: { confirmation_url: 'https://yookassa.ru/checkout/yk_12345' },
        }),
      });
      global.fetch = fetchMock as any;

      const provider = new YooKassaProvider();
      const result = await provider.createPayment(199000, 'RUB', {
        userId: 'user-123',
        description: 'Подписка PRO',
      });

      expect(result.paymentUrl).toBe('https://yookassa.ru/checkout/yk_12345');
      expect(result.providerTxId).toBe('yk_12345');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.yookassa.ru/v3/payments');
      const body = JSON.parse(init.body as string);
      expect(body.amount.value).toBe('1990.00'); // 199000 копеек -> рубли
      expect(body.metadata.userId).toBe('user-123');
    });

    it('sends Basic auth header built from shop id + secret key', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'yk_1', confirmation: { confirmation_url: 'https://x' } }),
      });
      global.fetch = fetchMock as any;

      const provider = new YooKassaProvider();
      await provider.createPayment(100000, 'RUB', { userId: 'u1' });

      const [, init] = fetchMock.mock.calls[0];
      const auth = (init.headers as Record<string, string>).Authorization;
      expect(auth).toBe('Basic ' + Buffer.from('shop-123:secret-abc').toString('base64'));
    });

    it('throws when YooKassa responds with a non-ok status', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'bad request',
      }) as any;

      const provider = new YooKassaProvider();
      await expect(
        provider.createPayment(100000, 'RUB', { userId: 'u1' }),
      ).rejects.toThrow(/YooKassa createPayment failed/);
    });
  });

  describe('getPayment', () => {
    it('returns the payment status from YooKassa', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'succeeded' }),
      }) as any;

      const provider = new YooKassaProvider();
      const result = await provider.getPayment('yk_12345');
      expect(result.status).toBe('succeeded');
    });

    it('throws when YooKassa responds with a non-ok status', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as any;
      const provider = new YooKassaProvider();
      await expect(provider.getPayment('missing')).rejects.toThrow(/YooKassa getPayment failed/);
    });
  });
});

describe('getPaymentProvider', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns null when PAYMENT_PROVIDER is not set to yookassa', () => {
    vi.stubEnv('PAYMENT_PROVIDER', '');
    expect(getPaymentProvider()).toBeNull();
  });

  it('returns a YooKassaProvider instance when PAYMENT_PROVIDER=yookassa', () => {
    vi.stubEnv('PAYMENT_PROVIDER', 'yookassa');
    expect(getPaymentProvider()).toBeInstanceOf(YooKassaProvider);
  });
});
