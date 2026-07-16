import { NextRequest, NextResponse } from 'next/server';
import { verifyTelegramInitData } from '@/src/lib/security/telegramWebApp';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';
import { findCabinetsByUserId, findCabinetById } from '@/src/db/repositories/wb-cabinets';
import { hasProFeatures } from '@/src/lib/billing/tariffs';
import { getRunAggregates, formatRub } from '@/src/lib/reports/runAggregates';

function monthLabel(date: Date): string {
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear().toString();
  return `${m}.${y}`;
}

export async function GET(req: NextRequest) {
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

  if (!isPro && !hasActiveSubscription) {
    return NextResponse.json({ error: 'Upgrade to PRO or BUSINESS to access statistics' }, { status: 403 });
  }

  const runs = await findRunsByUserId(user.id, 200);
  const completed = runs.filter(r => r.status === 'COMPLETED');

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

  const sorted = [...filtered]
    .sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb;
    });

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

  // Drill-down: к каждой точке основного графика привязываем runId
  const drill = slice.map(r => ({
    runId: r.id,
    label: r.created_at ? `${new Date(r.created_at).toLocaleDateString('ru-RU')}` : '?',
    lossPercent: r.turnover_kopeks && Number(r.turnover_kopeks) > 0
      ? Math.round((Number(r.loss_kopeks ?? 0) / Number(r.turnover_kopeks)) * 10000) / 100
      : 0,
  }));

  // ── Сводка (bigint-арифметика, конвертация в рубли один раз в конце) ──
  const summaryRuns = isPro ? filtered : slice;
  const totalRuns = summaryRuns.length;

  // Суммируем копейки как BigInt
  const totalExpectedKopeks = summaryRuns.reduce(
    (sum, r) => sum + BigInt(r.turnover_kopeks ?? 0),
    BigInt(0),
  );
  const totalReceivedKopeks = summaryRuns.reduce(
    (sum, r) => sum + BigInt(r.turnover_kopeks ?? 0) - BigInt(r.loss_kopeks ?? 0),
    BigInt(0),
  );
  const totalLossKopeks = summaryRuns.reduce(
    (sum, r) => sum + BigInt(r.loss_kopeks ?? 0),
    BigInt(0),
  );

  // Конвертируем в рубли для отображения
  const totalExpected = Number(totalExpectedKopeks) / 100;
  const totalReceived = Number(totalReceivedKopeks) / 100;
  const totalLoss = Number(totalLossKopeks) / 100;
  const avgLossPercent = totalExpected > 0 ? (totalLoss / totalExpected) * 100 : 0;

  const summary = {
    totalRuns,
    totalExpected,
    totalReceived,
    totalLoss,
    avgLossPercent: Math.round(avgLossPercent * 100) / 100,
  };

  const cabinets = await findCabinetsByUserId(user.id);
  const cabinetList = cabinets.map(c => ({ id: c.id, name: c.name }));

  // ── Разбивка по кабинетам (by_cabinet=true) ──
  const byCabinetParam = req.nextUrl.searchParams.get('by_cabinet');
  let cabinetChart: any = undefined;

  if (isPro && byCabinetParam === 'true' && cabinets.length > 1) {
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

    const { findImportById } = await import('@/src/db/repositories/imports');
    const runCabinetMap = new Map<string, string>();
    for (const run of sortedAll) {
      const wbImport = await findImportById(run.wb_import_id);
      const cabId = (wbImport as any)?.cabinet_id || null;
      if (cabId) runCabinetMap.set(run.id, cabId);
    }

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
      cabinetDatasets.push({ cabinetName: cab.name, expected, received, loss });
    }

    cabinetChart = { labels, datasets: cabinetDatasets };
  }

  // ── Тренд по месяцам (только для Pro) ──
  let monthlyTrend: any = undefined;
  if (isPro) {
    const monthMap = new Map<string, { expectedKopeks: bigint; receivedKopeks: bigint; lossKopeks: bigint; count: number }>();
    for (const run of filtered) {
      if (!run.created_at) continue;
      const key = monthLabel(new Date(run.created_at));
      const entry = monthMap.get(key) || { expectedKopeks: BigInt(0), receivedKopeks: BigInt(0), lossKopeks: BigInt(0), count: 0 };
      entry.expectedKopeks += BigInt(run.turnover_kopeks ?? 0);
      entry.receivedKopeks += BigInt(run.turnover_kopeks ?? 0) - BigInt(run.loss_kopeks ?? 0);
      entry.lossKopeks += BigInt(run.loss_kopeks ?? 0);
      entry.count += 1;
      monthMap.set(key, entry);
    }
    const months = Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12);
    monthlyTrend = {
      labels: months.map(([key]) => key),
      expected: months.map(([, v]) => Number(v.expectedKopeks) / 100),
      received: months.map(([, v]) => Number(v.receivedKopeks) / 100),
      loss: months.map(([, v]) => Number(v.lossKopeks) / 100),
      lossPercent: months.map(([, v]) => {
        const exp = Number(v.expectedKopeks);
        const loss = Number(v.lossKopeks);
        return exp > 0 ? Math.round((loss / exp) * 10000) / 100 : 0;
      }),
    };
  }

  return NextResponse.json({
    ok: true,
    preview: !isPro && hasActiveSubscription,
    chart: chartData,
    drill,
    summary,
    cabinets: cabinetList,
    cabinetChart,
    monthlyTrend,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
