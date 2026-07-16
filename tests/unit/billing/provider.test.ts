import { describe, it, expect } from 'vitest';
import { MockPaymentProvider } from '@/src/lib/billing/provider';

describe('MockPaymentProvider', () => {
  const provider = new MockPaymentProvider();

  describe('createPayment', () => {
    it('returns a paymentUrl and providerTxId', async () => {
      const result = await provider.createPayment(150000, 'RUB', {
        userId: 'user-123',
        description: 'Test payment',
      });

      expect(result.paymentUrl).toContain('/api/billing/mock-payment');
      expect(result.paymentUrl).toContain('txId=');
      expect(result.paymentUrl).toContain('userId=user-123');
      expect(result.providerTxId).toMatch(/^mock_/);
    });

    it('generates unique providerTxIds', async () => {
      const r1 = await provider.createPayment(150000, 'RUB', { userId: 'u1' });
      const r2 = await provider.createPayment(150000, 'RUB', { userId: 'u1' });

      expect(r1.providerTxId).not.toBe(r2.providerTxId);
    });

    it('includes userId in the payment URL', async () => {
      const result = await provider.createPayment(150000, 'RUB', {
        userId: 'abc-def-ghi',
      });
      expect(result.paymentUrl).toContain('userId=abc-def-ghi');
    });
  });

  describe('verifyWebhook', () => {
    it('always returns true for mock', () => {
      expect(provider.verifyWebhook({}, '')).toBe(true);
      expect(provider.verifyWebhook({ foo: 'bar' }, 'any-sig')).toBe(true);
    });
  });
});
