import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunById } from '@/src/db/repositories/reconciliation-runs';
import { msg } from '../messages.ru';

function rub(kopeks: bigint): string {
  const neg = kopeks < BigInt(0);
  const abs = neg ? -kopeks : kopeks;
  const whole = abs / BigInt(100);
  const cents = abs % BigInt(100);
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return `${neg ? '−' : ''}${grouped},${cents.toString().padStart(2, '0')} ₽`;
}

export async function handleClaimText(ctx: any, runId: string): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) {
    await ctx.reply(msg.accessExpired);
    return;
  }

  const run = await findRunById(runId);
  if (!run || run.user_id !== user.id) {
    await ctx.reply('Сверка не найдена.');
    return;
  }

  if (run.status !== 'COMPLETED') {
    await ctx.reply('Сверка ещё не завершена, текст претензии недоступен.');
    return;
  }

  const lossKopeks = run.loss_kopeks ?? BigInt(0);
  if (lossKopeks <= BigInt(0)) {
    await ctx.reply('Недоплата не обнаружена. Претензия не требуется.');
    return;
  }

  const period = run.started_at
    ? new Date(run.started_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : 'неизвестную дату';

  const claim = [
    'Шаблон претензии в Wildberries',
    '',
    `Дата сверки: ${period}`,
    `Ожидаемая выплата: ${rub(run.turnover_kopeks ?? BigInt(0))}`,
    `Фактически поступило: ${rub((run.turnover_kopeks ?? BigInt(0)) - lossKopeks)}`,
    `Недоплата: ${rub(lossKopeks)}`,
    '',
    'Текст обращения:',
    '',
    `Здравствуйте. Прошу разъяснить причину расхождения между суммой, указанной в еженедельном отчёте, и фактическим поступлением на расчётный счёт.`,
    `Период: ${period}. Ожидаемая выплата: ${rub(run.turnover_kopeks ?? BigInt(0))}, поступило: ${rub((run.turnover_kopeks ?? BigInt(0)) - lossKopeks)}.`,
    `Недоплата: ${rub(lossKopeks)}.`,
    'Прошу проверить корректность расчётов и произвести доплату недостающей суммы в кратчайшие сроки.',
    'С уважением,',
    '[Ваше имя]',
    '[Ваш контактный телефон]',
  ].join('\n');

  await ctx.reply(claim);
}
