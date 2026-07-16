import type { Context } from 'telegraf';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';
import { findImportById } from '@/src/db/repositories/imports';
import { buildCombinedXlsx } from '@/src/lib/reports/combinedExport';
import { hasBusinessFeatures } from '@/src/lib/billing/tariffs';

// Локальный тип вместо удалённого router.ts
export interface BotContext {
  from: { id: number; username?: string } | undefined;
  reply(text: string, extra?: unknown): Promise<unknown>;
  answerCbQuery?: (text?: string) => Promise<unknown>;
}

async function sendDocument(telegramId: bigint, buffer: Buffer, filename: string, contentType: string, caption?: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const formData = new FormData();
  formData.append('chat_id', String(telegramId));
  formData.append('document', new Blob([buffer], { type: contentType }), filename);
  if (caption) formData.append('caption', caption);
  await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: formData });
}

export async function handleSummaryExport(ctx: BotContext, cabinetId?: string): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || !hasBusinessFeatures(user.tariff)) {
    await ctx.reply('Сводный экспорт доступен только на тарифе «Бизнес».');
    return;
  }

  const runs = await findRunsByUserId(user.id, 500);
  const completed = runs.filter(r => r.status === 'COMPLETED');

  let filtered = completed;
  let label = 'все кабинеты';
  if (cabinetId) {
    const filteredRuns: typeof completed = [];
    for (const run of completed) {
      const wbImport = await findImportById(run.wb_import_id);
      if ((wbImport as any)?.cabinet_id === cabinetId) {
        filteredRuns.push(run);
      }
    }
    filtered = filteredRuns;
    label = `кабинет ${cabinetId.slice(0, 8)}`;
  }

  if (filtered.length === 0) {
    await ctx.reply('Нет завершённых сверок для экспорта.');
    return;
  }

  // Собираем массив run.id для функции сводного экспорта
  const runIds = filtered.map(r => r.id);

  try {
    const xlsxBuffer = await buildCombinedXlsx(runIds);
    const caption = `Сводный отчёт: ${label}, сверок за период: ${filtered.length}`;

    await sendDocument(
      user.telegram_id!,
      xlsxBuffer,
      `Sverka_сводка_${label}_${Date.now()}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      caption,
    );
  } catch (err) {
    console.error('[summaryExport] error:', err);
    await ctx.reply('Не удалось сформировать сводный отчёт. Попробуйте позже.');
  }
}
