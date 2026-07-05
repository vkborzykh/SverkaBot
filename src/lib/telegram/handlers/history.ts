import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';
import { findCabinetsByUserId } from '@/src/db/repositories/wb-cabinets';
import { msg } from '@/src/lib/telegram/messages.ru';
import type { BotContext } from '@/src/lib/telegram/router';

function fmtDate(d: string | Date): string {
  const dt = new Date(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

export async function handleHistory(ctx: BotContext): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) {
    await ctx.reply(msg.historyEmpty);
    return;
  }

  const runs = await findRunsByUserId(user.id, 50);
  const completed = runs.filter((r) => r.status === 'COMPLETED');

  if (completed.length === 0) {
    await ctx.reply(msg.historyEmpty);
    return;
  }

  // Пытаемся сгруппировать по кабинетам
  const cabinets = await findCabinetsByUserId(user.id);

  if (cabinets.length > 0) {
    // Есть кабинеты — группируем
    const cabinetMap = new Map(cabinets.map((c) => [c.id, c.name]));
    const byCabinet = new Map<string | null, typeof completed>();
    byCabinet.set(null, []); // сверки без кабинета

    for (const cab of cabinets) {
      byCabinet.set(cab.id, []);
    }

    // Распределяем сверки по кабинетам
    for (const run of completed) {
      // Ищем cabinet_id через импорт WB
      const { findImportById } = await import('@/src/db/repositories/imports');
      const wbImport = await findImportById(run.wb_import_id);
      const cabId = (wbImport as { cabinet_id?: string | null } | undefined)?.cabinet_id ?? null;
      const target = cabId && byCabinet.has(cabId) ? cabId : null;
      byCabinet.get(target)!.push(run);
    }

    // Формируем сообщение
    const lines: string[] = [];
    // Сначала сверки без кабинета
    const noCab = byCabinet.get(null)!;
    if (noCab.length > 0) {
      lines.push('📂 Без кабинета:');
      noCab.forEach((r, i) => {
        lines.push(msg.historyEntry(i + 1, fmtDate(r.created_at), r.loss_kopeks ?? BigInt(0)));
      });
      lines.push('');
    }
    // Затем по кабинетам
    for (const cab of cabinets) {
      const cabRuns = byCabinet.get(cab.id)!;
      if (cabRuns.length > 0) {
        lines.push(`🗂 ${cab.name}:`);
        cabRuns.forEach((r, i) => {
          lines.push(msg.historyEntry(i + 1, fmtDate(r.created_at), r.loss_kopeks ?? BigInt(0)));
        });
        lines.push('');
      }
    }

    await ctx.reply(`${msg.historyHeader}\n\n${lines.join('\n')}`);
  } else {
    // Нет кабинетов — обычный список
    const lines = completed.map((r, i) =>
      msg.historyEntry(i + 1, fmtDate(r.created_at), r.loss_kopeks ?? BigInt(0)),
    );
    await ctx.reply(`${msg.historyHeader}\n\n${lines.join('\n')}`);
  }
}
