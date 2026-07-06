import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunsByUserId, findRunById } from '@/src/db/repositories/reconciliation-runs';
import { findCabinetsByUserId } from '@/src/db/repositories/wb-cabinets';
import { findPrimaryReportByRunId } from '@/src/db/repositories/reports';
import { loadFile } from '@/src/lib/ingestion/storage';
import { msg } from '@/src/lib/telegram/messages.ru';
import { hasBusinessFeatures } from '@/src/lib/billing/tariffs';
import type { BotContext } from '@/src/lib/telegram/router';

function fmtDate(d: string | Date): string {
  const dt = new Date(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}.${dt.getFullYear()}`;
}

/** Отправляет список сверок как inline-кнопки с заданным текстовым заголовком */
async function sendRunList(ctx: BotContext, header: string, runs: any[]) {
  const buttons = runs.map((r, i) => ({
    text: `${i + 1}. ${fmtDate(r.created_at)} – ${r.loss_kopeks && BigInt(r.loss_kopeks) > BigInt(0) ? 'недоплата' : 'ок'}`,
    callback_data: `history_report:${r.id}`,
  }));
  const inlineKeyboard = buttons.map((btn) => [btn]);
  await ctx.reply(header, { reply_markup: { inline_keyboard: inlineKeyboard } });
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

  const cabinets = await findCabinetsByUserId(user.id);

  if (cabinets.length > 0) {
    // Группируем сверки по cabinet_id
    const byCabinet = new Map<string | null, typeof completed>();
    byCabinet.set(null, []); // сверки без кабинета

    for (const cab of cabinets) {
      byCabinet.set(cab.id, []);
    }

    for (const run of completed) {
      const { findImportById } = await import('@/src/db/repositories/imports');
      const wbImport = await findImportById(run.wb_import_id);
      const cabId = (wbImport as { cabinet_id?: string | null } | undefined)?.cabinet_id ?? null;
      const target = cabId && byCabinet.has(cabId) ? cabId : null;
      byCabinet.get(target)!.push(run);
    }

    // Сверки без кабинета
    const noCab = byCabinet.get(null)!;
    if (noCab.length > 0) {
      await sendRunList(ctx, msg.historyHeader, noCab);
    }

    // По каждому кабинету отдельное сообщение
    for (const cab of cabinets) {
      const cabRuns = byCabinet.get(cab.id)!;
      if (cabRuns.length > 0) {
        const header = `📜 Последние сверки кабинета ${cab.name}:`;
        await sendRunList(ctx, header, cabRuns);
      }
    }
  } else {
    // Нет кабинетов – один список
    await sendRunList(ctx, msg.historyHeader, completed);
  }
}

/** Отправка HTML-отчёта сверки документом в чат. Ownership уже проверен вызывающим. */
async function sendHtmlForRun(ctx: BotContext, telegramId: bigint, runId: string): Promise<void> {
  const report = await findPrimaryReportByRunId(runId);
  if (!report || !report.storage_path) {
    await ctx.reply(msg.historyReportExpired);
    return;
  }
  if (report.retention_days) {
    const expiryDate = new Date(report.created_at.getTime() + report.retention_days * 24 * 60 * 60 * 1000);
    if (new Date() > expiryDate) {
      await ctx.reply(msg.historyReportExpired);
      return;
    }
  }
  try {
    const buffer = await loadFile(report.storage_path);
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;
    const blob = new Blob([buffer], { type: 'text/html' });
    const formData = new FormData();
    formData.append('chat_id', String(telegramId));
    formData.append('document', blob, `report_${runId.slice(0, 8)}.html`);
    formData.append('caption', msg.reportCaption);
    await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: formData,
    });
  } catch (err) {
    console.error('[historyReport] failed to send report:', err);
    await ctx.reply(msg.getReportError);
  }
}

/** ⚠️ Ownership-проверка сверки. Возвращает user при успехе, иначе null. */
async function checkRunOwnership(ctx: BotContext, runId: string) {
  const from = ctx.from;
  if (!from) return null;
  const user = await findUserByTelegramId(BigInt(from.id));
  if (!user) return null;
  const run = await findRunById(runId);
  if (!run || run.user_id !== user.id) {
    await ctx.reply(msg.syncStatusNotFound);
    return null;
  }
  return user;
}

/** Нажатие на сверку в истории: BUSINESS → выбор формата, остальные → HTML. */
export async function handleHistoryReport(ctx: BotContext, runId: string): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await checkRunOwnership(ctx, runId);
  if (!user) return;

  if (hasBusinessFeatures(user.tariff)) {
    await ctx.reply(msg.historyChooseFormat, {
      reply_markup: {
        inline_keyboard: [[
          { text: msg.historyHtmlButton, callback_data: `history_html:${runId}` },
          { text: msg.historyCsvButton, callback_data: `history_csv:${runId}` },
        ]],
      },
    });
    return;
  }
  if (!user.telegram_id) return;
  await sendHtmlForRun(ctx, user.telegram_id, runId);
}

/** Кнопка «📄 HTML» из истории. */
export async function handleHistoryHtml(ctx: BotContext, runId: string): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await checkRunOwnership(ctx, runId);
  if (!user || !user.telegram_id) return;
  await sendHtmlForRun(ctx, user.telegram_id, runId);
}
