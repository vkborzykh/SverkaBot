import { NextRequest, NextResponse } from 'next/server';
import { verifyTelegramInitData } from '@/src/lib/security/telegramWebApp';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';
import { findCabinetsByUserId, findCabinetById } from '@/src/db/repositories/wb-cabinets';
import { hasProFeatures } from '@/src/lib/billing/tariffs';
import { getRunAggregates, formatRub } from '@/src/lib/reports/runAggregates';

export async function GET(req: NextRequest) {
  // Извлекаем initData из заголовка Authorization: tma <initData>
  const authHeader = req.headers.get('authorization') ?? '';
  const initData = authHeader.startsWith('tma ') ? authHeader.slice(4) : '';
  if (!initData) {
    return NextResponse.json({ error: 'Missing initData' }, { status: 401 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  const result = verifyTelegramInitData(initData, botToken);
  if (!result.ok) {
    return NextResponse.json({ error: `Invalid initData: ${result.reason}` }, { status: 401 });
  }

  const user = await findUserByTelegramId(BigInt(result.user.id));
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const isPro = hasProFeatures(user.tariff, user.subscription_status, user.trial_expires_at);
  const hasActiveSubscription = user.subscription_status === 'ACTIVE' || user.subscription_status === 'TRIAL';

  // Если нет Pro-доступа и нет активной подписки – отказ
  if (!isPro && !hasActiveSubscription) {
    return NextResponse.json({ error: 'Upgrade to PRO or BUSINESS to access statistics' }, { status: 403 });
  }

  // Получаем данные для графика (последние 12 сверок для Pro, 2 для preview)
  const runs = await findRunsByUserId(user.id, 200);
  const completed = runs.filter(r => r.status === 'COMPLETED');

  // Если передан фильтр по кабинету, проверяем владение и фильтруем
  const cabinetId = req.nextUrl.searchParams.get('cabinet_id');
  let filtered = completed;
  if (cabinetId) {
    const cabinet = await findCabinetById(cabinetId);
    if (cabinet && cabinet.user_id === user.id) {
      const { findImportById } = await import('@/src/db/repositories/imports');
      const filteredRuns: typeof completed = [];
      for (const run of completed) {
        const wbImport = await findImportById(run.wb_import_id);
        if ((wbImport as any)?.cabinet_id === cabinetId) {
          filteredRuns.push(run);
        }
      }
      filtered = filteredRuns;
    }
  }

  // Сортировка по дате
  const sorted = [...filtered]
    .sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb;
    });

  // Определяем, сколько точек отдавать: для предпросмотра – 2, иначе 12
  const maxPoints = isPro ? 12 : 2;
  const slice = sorted.slice(-maxPoints);

  const chartData = {
    labels: slice.map(r => {
      const d = r.created_at ? new Date(r.created_at) : new Date();
      return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    }),
    expected: slice.map(r => Number(r.turnover_kopeks ?? 0) / 100),
    received: slice.map(r => (Number(r.turnover_kopeks ?? 0) - Number(r.loss_kopeks ?? 0)) / 100),
    loss: slice.map(r => Number(r.loss_kopeks ?? 0) / 100),
  };

  // ── Текстовая сводка ──────────────────────────────────────────────────────
  const summaryRuns = isPro ? filtered : slice; // для сводки используем все отфильтрованные либо ограниченные
  const totalRuns = summaryRuns.length;
  const totalExpected = summaryRuns.reduce((sum, r) => sum + Number(r.turnover_kopeks ?? 0), 0) / 100;
  const totalReceived = summaryRuns.reduce((sum, r) => sum + (Number(r.turnover_kopeks ?? 0) - Number(r.loss_kopeks ?? 0)), 0) / 100;
  const totalLoss = summaryRuns.reduce((sum, r) => sum + Number(r.loss_kopeks ?? 0), 0) / 100;
  const avgLossPercent = totalExpected > 0 ? (totalLoss / totalExpected) * 100 : 0;

  const summary = {
    totalRuns,
    totalExpected,
    totalReceived,
    totalLoss,
    avgLossPercent: Math.round(avgLossPercent * 100) / 100,
  };

  // ── Список кабинетов ──────────────────────────────────────────────────────
  const cabinets = await findCabinetsByUserId(user.id);
  const cabinetList = cabinets.map(c => ({ id: c.id, name: c.name }));

  // ── Разбивка по кабинетам (только для Pro/Business при by_cabinet=true) ──
  const byCabinetParam = req.nextUrl.searchParams.get('by_cabinet');
  let cabinetChart: any = undefined;

  if (isPro && byCabinetParam === 'true' && cabinets.length > 1) {
    // Берём последние 12 run'ов пользователя (без фильтра по кабинету) для единой оси X
    const sortedAll = [...completed]
      .sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return ta - tb;
      })
      .slice(-12);

    const labels = sortedAll.map(r => {
      const d = r.created_at ? new Date(r.created_at) : new Date();
      return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    });

    // Получаем cabinet_id для каждого run через импорт
    const { findImportById } = await import('@/src/db/repositories/imports');
    const runCabinetMap = new Map<string, string>(); // runId -> cabinetId
    for (const run of sortedAll) {
      const wbImport = await findImportById(run.wb_import_id);
      const cabId = (wbImport as any)?.cabinet_id || null;
      if (cabId) runCabinetMap.set(run.id, cabId);
    }

    // Формируем массивы для каждого кабинета
    const cabinetDatasets: any[] = [];
    for (const cab of cabinets) {
      const expected: number[] = [];
      const received: number[] = [];
      const loss: number[] = [];

      for (const run of sortedAll) {
        const runCab = runCabinetMap.get(run.id);
        if (runCab === cab.id) {
          expected.push(Number(run.turnover_kopeks ?? 0) / 100);
          received.push((Number(run.turnover_kopeks ?? 0) - Number(run.loss_kopeks ?? 0)) / 100);
          loss.push(Number(run.loss_kopeks ?? 0) / 100);
        } else {
          expected.push(0);
          received.push(0);
          loss.push(0);
        }
      }

      cabinetDatasets.push({
        cabinetName: cab.name,
        expected,
        received,
        loss,
      });
    }

    cabinetChart = {
      labels,
      datasets: cabinetDatasets,
    };
  }

  return NextResponse.json({
    ok: true,
    preview: !isPro && hasActiveSubscription,
    chart: chartData,
    summary,
    cabinets: cabinetList,
    cabinetChart,
  }, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
