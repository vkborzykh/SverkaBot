import { NextRequest, NextResponse } from 'next/server';
import {
  findBillingTransactionByProviderTxId,
  updateBillingTransaction,
} from '@/src/db/repositories/billing-transactions';
import { findUserById } from '@/src/db/repositories/users';
import { activateSubscription } from '@/src/lib/billing/subscription';

const SUBSCRIPTION_DAYS = 30;

export async function GET(req: NextRequest) {
  const txId = req.nextUrl.searchParams.get('txId');
  const userId = req.nextUrl.searchParams.get('userId');

  if (!txId || !userId) {
    return new NextResponse(htmlPage('Ошибка', 'Неверная ссылка для оплаты.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const tx = await findBillingTransactionByProviderTxId(txId);
  if (!tx || tx.user_id !== userId) {
    return new NextResponse(htmlPage('Ошибка', 'Транзакция не найдена.'), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Idempotency: already paid
  if (tx.status === 'SUCCESS') {
    return new NextResponse(
      htmlPage('Оплата', 'Оплата уже была проведена ранее. Можете закрыть эту страницу.'),
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  // Simulate successful payment
  await updateBillingTransaction(tx.id, { status: 'SUCCESS' });
  const endDate = await activateSubscription(userId, SUBSCRIPTION_DAYS);

  // Notify user via Telegram
  const user = await findUserById(userId);
  if (user?.telegram_id) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      const formatted = endDate.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
      });
      const text = `Оплата прошла успешно! Ваша подписка активна до ${formatted}. Спасибо!`;
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: String(user.telegram_id), text }),
      }).catch(() => {});
    }
  }

  return new NextResponse(
    htmlPage(
      'Оплата успешна',
      'Оплата прошла успешно! Теперь вы можете закрыть эту страницу и вернуться в бот.',
    ),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

function htmlPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8f9fa; }
    .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); text-align: center; max-width: 400px; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; color: #1a1a1a; }
    p { color: #555; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
