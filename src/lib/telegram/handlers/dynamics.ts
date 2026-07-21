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

function uniqueRunsByImports(runs: any[]): any[] {
  const seen = new Set<string>();
  const sorted = [...runs].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });
  const result: any[] = [];
  for (const run of sorted) {
    const key = `${run.wb_import_id}:${run.bank_import_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(run);
    }
  }
  return result;
}

function buildStatisticsLines(runs: any[], label?: string): string[] {
  let totalExpected = BigInt(0);
  let totalReceived = BigInt(0);
  let totalLoss = BigInt(0);
  let lossCount = 0;

  for (const run of runs) {
    const turnover = BigInt(run.turnover_kopeks ?? 0);
    const loss = BigInt(run.loss_kopeks ?? 0);
    totalExpected += turnover;
    totalReceived += turnover - loss;
    totalLoss += loss;
    if (loss > BigInt(0)) {
      lossCount++;
    }
  }

  const avgLossPercent = runs.length > 0
    ? ((runs.filter((r) => r.loss_percent).reduce((s, r) => s + Number(r.loss_percent), 0)) / runs.length).toFixed(1)
    : '0.0';

  const header = label ? `📈 ${label}` : msg.statisticsHeader;

  return [
    header,
    '',
    msg.statisticsTotalRuns(runs.length),
    msg.statisticsTotalExpected(rub(totalExpected)),
    msg.statisticsTotalReceived(rub(totalReceived)),
    msg.statisticsTotalLoss(rub(totalLoss)),
    msg.statisticsAvgLossPercent(avgLossPercent),
    `Сверок с расхождениями: ${lossCount}`,
  ];
}

/** Отправляет кнопку с WebApp для интерактивной статистики */
function sendWebAppButton(ctx: Context, userTelegramId: bigint) {
  const baseUrl = process.env.PUBLIC_URL || 'https://sverka-bot-3dns.vercel.app';
  const webAppUrl = `${baseUrl}/miniapp/stats.html`;
  return ctx.reply('📊 Открыть интерактивную статистику', {
    reply_markup: {
      inline_keyboard: [[
        { text: '📈 Открыть статистику', web_app: { url: webAppUrl } }
      ]],
    },
  });
}

export async function handleStatistics(ctx: Context): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) {
    await ctx.reply('Пользователь не найден.');
    return;
  }

  if (!hasProFeatures(user.tariff)) {
    await ctx.reply(msg.statisticsUpgradeToPro);
    return;
  }

  const runs = await findRunsByUserId(user.id, 200);
  const completed = runs.filter((r) => r.status === 'COMPLETED');

  if (completed.length === 0) {
    await ctx.reply('Нет завершённых сверок для отображения.');
    return;
  }

  const uniqueCompleted = uniqueRunsByImports(completed);

  // Текстовая сводка
  const lines = buildStatisticsLines(uniqueCompleted);
  await ctx.reply(lines.join('\n'));

  // Кнопка WebApp вместо PNG‑графика
  await sendWebAppButton(ctx, user.telegram_id!);

  // Фильтр по кабинетам, если есть
  const cabinets = await findCabinetsByUserId(user.id);
  if (cabinets.length > 0) {
    const filterButtons = cabinets.map((c) => ({
      text: msg.statisticsCabinetLabel(c.name),
      callback_data: `statistics_cabinet:${c.id}`,
    }));

    await ctx.reply('Выберите кабинет для детализации:', {
      reply_markup: {
        inline_keyboard: [
          ...filterButtons.map((btn) => [btn]),
          [{ text: msg.statisticsFilterAll, callback_data: 'statistics_all' }],
        ],
      },
    });
  }
}

export async function handleStatisticsFilter(ctx: Context, cabinetId?: string): Promise<void> {
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user) return;

  const runs = await findRunsByUserId(user.id, 200);
  const completed = runs.filter((r) => r.status === 'COMPLETED');

  if (completed.length === 0) return;

  let filtered = completed;
  let filterLabel = '';

  if (cabinetId && cabinetId !== 'all') {
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

  const uniqueFiltered = uniqueRunsByImports(filtered);

  if (uniqueFiltered.length === 0) {
    await ctx.reply('Нет данных для выбранного кабинета.');
    return;
  }

  // Текстовая сводка
  const lines = buildStatisticsLines(uniqueFiltered, filterLabel);
  await ctx.reply(lines.join('\n'));

  // Кнопка WebApp (та же, без фильтрации в URL — пользователь сам выберет кабинет)
  await sendWebAppButton(ctx, user.telegram_id!);
}
