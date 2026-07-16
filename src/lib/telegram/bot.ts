import { Telegraf } from 'telegraf';

// Lazy singleton — only instantiated on first request, not at build time.
let _bot: Telegraf | undefined;

export function getBot(): Telegraf {
  if (!_bot) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
    _bot = new Telegraf(token);
  }
  return _bot;
}
