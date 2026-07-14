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

export class YooKassaProvider implements PaymentProvider {
  private shopId = process.env.YOOKASSA_SHOP_ID ?? '';
  private secretKey = process.env.YOOKASSA_SECRET_KEY ?? '';
  private returnUrl =
    process.env.YOOKASSA_RETURN_URL ??
    `${getBaseUrl().startsWith('http') ? getBaseUrl() : `https://${getBaseUrl()}`}/`;

  private authHeader(): string {
    return 'Basic ' + Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64');
  }

  async createPayment(
    amountKopeks: number,
    currency: string,
    metadata: { userId: string; description?: string },
  ): Promise<PaymentResult> {
    const value = (amountKopeks / 100).toFixed(2);
    const res = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: this.authHeader(),
        'Idempotence-Key': randomUUID(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: { value, currency },
        capture: true,
        confirmation: { type: 'redirect', return_url: this.returnUrl },
        description: metadata.description ?? 'Подписка SverkaBot 30 дней',
        metadata: { userId: metadata.userId },
      }),
    });
    if (!res.ok)
      throw new Error(`YooKassa createPayment failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      id: string;
      confirmation: { confirmation_url: string };
    };
    return { paymentUrl: data.confirmation.confirmation_url, providerTxId: data.id };
  }

  async getPayment(
    paymentId: string,
  ): Promise<{ status: string; metadata?: Record<string, string> }> {
    const res = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      headers: { Authorization: this.authHeader() },
    });
    if (!res.ok) throw new Error(`YooKassa getPayment failed: ${res.status}`);
    return res.json() as Promise<{ status: string; metadata?: Record<string, string> }>;
  }

  verifyWebhook(_payload: unknown, _signature: string): boolean {
    return true;
  }
}

/** Возвращает платёжный провайдер. Без явной настройки PAYMENT_PROVIDER=yookassa
 *  не возвращает ничего — вызывающий код должен обработать этот случай.
 */
export function getPaymentProvider(): PaymentProvider | null {
  if (process.env.PAYMENT_PROVIDER === 'yookassa') {
    return new YooKassaProvider();
  }
  return null;
}
