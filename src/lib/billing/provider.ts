import { randomUUID } from 'crypto';

export interface PaymentResult {
  paymentUrl: string;
  providerTxId: string;
}

export interface PaymentProvider {
  createPayment(
    amountKopeks: number,
    currency: string,
    metadata: { userId: string; description?: string },
  ): Promise<PaymentResult>;
  verifyWebhook(payload: unknown, signature: string): boolean;
}

function getBaseUrl(): string {
  return (
    process.env.PUBLIC_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VERCEL_URL ??
    'http://localhost:3000'
  );
}

export class MockPaymentProvider implements PaymentProvider {
  async createPayment(
    amountKopeks: number,
    currency: string,
    metadata: { userId: string; description?: string },
  ): Promise<PaymentResult> {
    const providerTxId = `mock_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const base = getBaseUrl().startsWith('http')
      ? getBaseUrl()
      : `https://${getBaseUrl()}`;
    const paymentUrl = `${base}/api/billing/mock-payment?txId=${providerTxId}&userId=${metadata.userId}`;
    return { paymentUrl, providerTxId };
  }

  verifyWebhook(_payload: unknown, _signature: string): boolean {
    return true;
  }
}

export function getPaymentProvider(): PaymentProvider {
  return new MockPaymentProvider();
}
