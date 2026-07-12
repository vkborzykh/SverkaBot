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
    totalExpected += run.turnover_kopeks ?? BigInt(0);
    totalReceived += (run.turnover_kopeks ?? BigInt(0)) - (run.loss_kopeks ?? BigInt(0));
    totalLoss += run.loss_kopeks ?? BigInt(0);
    if (run.loss_kopeks && BigInt(run.loss_kopeks) > BigInt(0)) {
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

/** Генерирует URL столбчатой диаграммы через QuickChart, показывая ожидаемые/полученные суммы и расхождения по последним сверкам. */
function generateChartUrl(runs: any[]): string {
  // Оставляем до 12 последних сверок (по дате завершения)
  const sorted = [...runs].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return ta - tb; // сначала старые
  });
  const lastRuns = sorted.slice(-12);

  const labels = lastRuns.map((r) => {
    const d = r.created_at ? new Date(r.created_at) : new Date();
    return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
  });

  const expectedData = lastRuns.map((r) => Number(r.turnover_kopeks ?? 0) / 100);
  const receivedData = lastRuns.map((r) => (Number(r.turnover_kopeks ?? 0) - Number(r.loss_kopeks ?? 0)) / 100);
  const lossData = lastRuns.map((r) => Number(r.loss_kopeks ?? 0) / 100);

  const chart = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Ожидалось (₽)',
          data: expectedData,
          backgroundColor: 'rgba(54, 162, 235, 0.7)',
        },
        {
          label: 'Поступило (₽)',
          data: receivedData,
          backgroundColor: 'rgba(75, 192, 192, 0.7)',
        },
        {
          label: 'Расхождение (₽)',
          data: lossData,
          backgroundColor: 'rgba(255, 99, 132, 0.7)',
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: 'Динамика выплат',
        },
      },
      scales: {
        x: { stacked: false },
        y: { stacked: false, beginAtZero: true },
      },
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(chart));
  return `https://quickchart.io/chart?c=${encoded}&width=600&height=400`;
}

async function sendPhotoToUser(telegramId: bigint, photoUrl: string, caption?: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(telegramId),
        photo: photoUrl,
        caption: caption || '',
      }),
    });
  } catch (err) {
    console.error('[sendPhotoToUser] error:', err);
  }
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

  // Отправляем текстовую сводку
  const lines = buildStatisticsLines(uniqueCompleted);
  await ctx.reply(lines.join('\n'));

  // Отправляем график, если есть завершённые сверки
  if (uniqueCompleted.length > 0) {
    const chartUrl = generateChartUrl(uniqueCompleted);
    await sendPhotoToUser(user.telegram_id!, chartUrl, 'График последних сверок');
  }

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

  // График по отфильтрованным данным
  const chartUrl = generateChartUrl(uniqueFiltered);
  await sendPhotoToUser(user.telegram_id!, chartUrl, `График по кабинету: ${filterLabel}`);
}
