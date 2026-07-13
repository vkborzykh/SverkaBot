import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let update: any;
  try {
    update = req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const chatId = extractChatId(update);
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (chatId && token) {
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: 'Тестовый ответ' }),
      });
    } catch (err) {
      console.error('sendMessage failed:', err);
    }
  }

  return res.status(200).json({ ok: true });
}

function extractChatId(update: any): number | undefined {
  if (update?.message?.chat?.id) return update.message.chat.id;
  if (update?.callback_query?.message?.chat?.id) return update.callback_query.message.chat.id;
  return undefined;
}
