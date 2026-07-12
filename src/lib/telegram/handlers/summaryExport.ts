// src/lib/telegram/handlers/summaryExport.ts
import type { Context } from 'telegraf';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';
import { findImportById } from '@/src/db/repositories/imports';
import { buildCsvForRun } from '@/src/lib/reports/exportCsv';
import { buildXlsxForRun } from '@/src/lib/reports/exportXlsx';
import { build1cForRun } from '@/src/lib/reports/export1c';
import { hasBusinessFeatures } from '@/src/lib/billing/tariffs';
import type { BotContext } from '../router';

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

  try {
    // Генерируем все три формата и отправляем отдельными сообщениями
    const csvBuffer = await buildCombinedCsv(filtered);
    const xlsxBuffer = await buildCombinedXlsx(filtered);
    const onecBuffer = await buildCombined1c(filtered);

    await sendDocument(user.telegram_id!, csvBuffer, `Sverka_сводка_${label}_${Date.now()}.csv`, 'text/csv', 'Сводный CSV по всем сверкам');
    await sendDocument(user.telegram_id!, xlsxBuffer, `Sverka_сводка_${label}_${Date.now()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Сводный Excel');
    await sendDocument(user.telegram_id!, onecBuffer, `Sverka_1C_сводка_${label}_${Date.now()}.csv`, 'text/csv', 'Реестр 1С по всем сверкам');
  } catch (err) {
    console.error('[summaryExport] error:', err);
    await ctx.reply('Не удалось сформировать сводный отчёт. Попробуйте позже.');
  }
}

async function buildCombinedCsv(runs: any[]): Promise<Buffer> {
  const buffers: Buffer[] = [];
  for (const run of runs) {
    try { buffers.push(await buildCsvForRun(run.id)); } catch {}
  }
  return Buffer.concat(buffers);
}

async function buildCombinedXlsx(runs: any[]): Promise<Buffer> {
  const buffers: Buffer[] = [];
  for (const run of runs) {
    try { buffers.push(await buildXlsxForRun(run.id)); } catch {}
  }
  return Buffer.concat(buffers);
}

async function buildCombined1c(runs: any[]): Promise<Buffer> {
  const buffers: Buffer[] = [];
  for (const run of runs) {
    try { buffers.push(await build1cForRun(run.id)); } catch {}
  }
  return Buffer.concat(buffers);
}
