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

  if (!hasProFeatures(user.tariff)) {
    return NextResponse.json({ error: 'Upgrade to PRO or BUSINESS to access statistics' }, { status: 403 });
  }

  // Получаем данные для графика (упрощённо — последние 12 сверок)
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
    // else — игнорируем невалидный cabinet_id, возвращаем все сверки пользователя
  }

  // Собираем агрегаты для графика (последние 12, сортировка по дате)
  const sorted = [...filtered]
    .sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb;
    })
    .slice(-12);

  const chartData = {
    labels: sorted.map(r => {
      const d = r.created_at ? new Date(r.created_at) : new Date();
      return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    }),
    expected: sorted.map(r => Number(r.turnover_kopeks ?? 0) / 100),
    received: sorted.map(r => (Number(r.turnover_kopeks ?? 0) - Number(r.loss_kopeks ?? 0)) / 100),
    loss: sorted.map(r => Number(r.loss_kopeks ?? 0) / 100),
  };

  // Список кабинетов для фильтра
  const cabinets = await findCabinetsByUserId(user.id);
  const cabinetList = cabinets.map(c => ({ id: c.id, name: c.name }));

  return NextResponse.json({
    ok: true,
    chart: chartData,
    cabinets: cabinetList,
  }, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
