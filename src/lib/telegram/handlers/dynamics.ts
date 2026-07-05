import type { Context } from 'telegraf';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';
import { findCabinetsByUserId } from '@/src/db/repositories/wb-cabinets';
import { hasProFeatures } from '@/src/lib/billing/tariffs';
import { msg } from '../messages.ru';

function rub(kopeks: bigint): string {
  const neg = kopeks < BigInt(0);
  const a = neg ? -kopeks : kopeks;
  const whole = (a / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  const cents = (a % BigInt(100)).toString().padStart(2, '0');
  return `${neg ? '−' : ''}${whole},${cents}\u00A0₽`;
}

export async function handleDynamics(ctx: Context): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) {
    await ctx.reply('Пользователь не найден.');
    return;
  }

  // Доступно только на Профи и Бизнес
  if (!hasProFeatures(user.tariff)) {
    await ctx.reply(msg.dynamicsUpgradeToPro);
    return;
  }

  const runs = await findRunsByUserId(user.id, 200);
  const completed = runs.filter((r) => r.status === 'COMPLETED');

  if (completed.length === 0) {
    await ctx.reply('Нет завершённых сверок для отображения.');
    return;
  }

  // Считаем итоги
  let totalExpected = BigInt(0);
  let totalReceived = BigInt(0);
  let totalLoss = BigInt(0);
  let lossCount = 0;

  for (const run of completed) {
    totalExpected += run.turnover_kopeks ?? BigInt(0);
    totalReceived += (run.turnover_kopeks ?? BigInt(0)) - (run.loss_kopeks ?? BigInt(0));
    totalLoss += run.loss_kopeks ?? BigInt(0);
    if (run.loss_kopeks && BigInt(run.loss_kopeks) > BigInt(0)) {
      lossCount++;
    }
  }

  const avgLossPercent = completed.length > 0
    ? ((completed.filter((r) => r.loss_percent).reduce((s, r) => s + Number(r.loss_percent), 0)) / completed.length).toFixed(1)
    : '0.0';

  // Фильтр по кабинетам
  const cabinets = await findCabinetsByUserId(user.id);
  const filterButtons = cabinets.map((c) => ({
    text: msg.dynamicsCabinetLabel(c.name),
    callback_data: `dynamics_cabinet:${c.id}`,
  }));

  const lines = [
    msg.dynamicsHeader,
    '',
    msg.dynamicsTotalRuns(completed.length),
    msg.dynamicsTotalExpected(rub(totalExpected)),
    msg.dynamicsTotalReceived(rub(totalReceived)),
    msg.dynamicsTotalLoss(rub(totalLoss)),
    msg.dynamicsAvgLossPercent(avgLossPercent),
  ];

  if (lossCount > 0) {
    lines.push(`Сверок с расхождениями: ${lossCount}`);
  }

  if (cabinets.length > 1) {
    lines.push('');
    lines.push('Выберите кабинет для детализации:');
    await ctx.reply(lines.join('\n'), {
      reply_markup: {
        inline_keyboard: [
          ...filterButtons.map((btn) => [btn]),
          [{ text: msg.dynamicsFilterAll, callback_data: 'dynamics_all' }],
        ],
      },
    });
  } else {
    await ctx.reply(lines.join('\n'));
  }
}

export async function handleDynamicsFilter(ctx: Context, cabinetId?: string): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;

  const runs = await findRunsByUserId(user.id, 200);
  const completed = runs.filter((r) => r.status === 'COMPLETED');

  if (completed.length === 0) return;

  let filtered = completed;
  let filterLabel = '';

  if (cabinetId && cabinetId !== 'all') {
    // Фильтруем по кабинету
    const { findImportById } = await import('@/src/db/repositories/imports');
    const filteredRuns: typeof completed = [];

    for (const run of completed) {
      const wbImport = await findImportById(run.wb_import_id);
      const cabId = (wbImport as { cabinet_id?: string | null } | undefined)?.cabinet_id;
      if (cabId === cabinetId) {
        filteredRuns.push(run);
      }
    }
    filtered = filteredRuns;

    const cabinet = await (await import('@/src/db/repositories/wb-cabinets')).findCabinetById(cabinetId);
    filterLabel = cabinet ? cabinet.name : 'Кабинет';
  } else {
    filterLabel = 'Все кабинеты';
  }

  let totalExpected = BigInt(0);
  let totalReceived = BigInt(0);
  let totalLoss = BigInt(0);
  for (const run of filtered) {
    totalExpected += run.turnover_kopeks ?? BigInt(0);
    totalReceived += (run.turnover_kopeks ?? BigInt(0)) - (run.loss_kopeks ?? BigInt(0));
    totalLoss += run.loss_kopeks ?? BigInt(0);
  }

  const avgLossPercent = filtered.length > 0
    ? ((filtered.filter((r) => r.loss_percent).reduce((s, r) => s + Number(r.loss_percent), 0)) / filtered.length).toFixed(1)
    : '0.0';

  const lines = [
    `📊 ${filterLabel}`,
    '',
    msg.dynamicsTotalRuns(filtered.length),
    msg.dynamicsTotalExpected(rub(totalExpected)),
    msg.dynamicsTotalReceived(rub(totalReceived)),
    msg.dynamicsTotalLoss(rub(totalLoss)),
    msg.dynamicsAvgLossPercent(avgLossPercent),
  ];

  await ctx.reply(lines.join('\n'));
}
