import type { Context } from 'telegraf';
import { findUserByTelegramId } from '@/src/db/repositories/users';
import { findRunsByUserId } from '@/src/db/repositories/reconciliation-runs';
import { findImportById } from '@/src/db/repositories/imports';
import { buildSummaryWorkbook } from '@/src/lib/reports/summaryWorkbook';
import { hasBusinessFeatures } from '@/src/lib/billing/tariffs';
import { toRubNumber } from '@/src/lib/reports/runAggregates';

// Локальный тип вместо удалённого router.ts
export interface BotContext {
  from: { id: number; username?: string } | undefined;
  reply(text: string, extra?: unknown): Promise<unknown>;
  answerCbQuery?: (text?: string) => Promise<unknown>;
}

export type SummaryPeriod = 'week' | 'month' | 'prev_month' | 'all';

const PERIOD_LABEL: Record<SummaryPeriod, string> = {
  week: 'за эту неделю',
  month: 'за этот месяц',
  prev_month: 'за прошлый месяц',
  all: 'за всё время',
};

/**
 * Диапазон дат для фильтрации по ПОЛЮ run.created_at (дата выполнения сверки,
 * а не дата периода самого WB-отчёта). Выбрано сознательно как более простой
 * и предсказуемый критерий — см. обсуждение в чате.
 */
function periodRange(period: SummaryPeriod): { from: Date | null; to: Date | null } {
  const now = new Date();
  if (period === 'week') {
    const from = new Date(now);
    from.setDate(from.getDate() - 7);
    return { from, to: now };
  }
  if (period === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    return { from, to: now };
  }
  if (period === 'prev_month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { from, to };
  }
  return { from: null, to: null }; // 'all' — без фильтра
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

/**
 * Шаг 0 редизайна: перед генерацией отчёта спрашиваем период — иначе
 * "сводный отчёт" смешивает сверки за произвольно давние периоды в одну кучу
 * без возможности сузить до "что происходило за эту неделю/месяц".
 */
export async function handleSummaryPeriodPick(ctx: BotContext, cabinetId?: string): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || !hasBusinessFeatures(user.tariff)) {
    await ctx.reply('Сводный экспорт доступен только на тарифе «Бизнес».');
    return;
  }

  const idPart = cabinetId ?? 'all';
  await ctx.reply('За какой период сформировать сводный отчёт?', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '📅 Эта неделя', callback_data: `summary_export:${idPart}:week` },
          { text: '📅 Этот месяц', callback_data: `summary_export:${idPart}:month` },
        ],
        [
          { text: '📅 Прошлый месяц', callback_data: `summary_export:${idPart}:prev_month` },
          { text: '📅 Вся история', callback_data: `summary_export:${idPart}:all` },
        ],
      ],
    },
  });
}

export async function handleSummaryExport(ctx: BotContext, cabinetId: string | undefined, period: SummaryPeriod = 'all'): Promise<void> {
  await ctx.answerCbQuery?.();
  const user = await findUserByTelegramId(BigInt(ctx.from!.id));
  if (!user || !hasBusinessFeatures(user.tariff)) {
    await ctx.reply('Сводный экспорт доступен только на тарифе «Бизнес».');
    return;
  }

  const runs = await findRunsByUserId(user.id, 500);
  const completed = runs.filter(r => r.status === 'COMPLETED');

  const { from, to } = periodRange(period);
  const inPeriod = completed.filter(r => {
    if (!from || !to) return true; // 'all'
    const createdAt = r.created_at ? new Date(r.created_at) : null;
    if (!createdAt) return false;
    return createdAt >= from && createdAt <= to;
  });

  let filtered = inPeriod;
  let label = 'все кабинеты';
  if (cabinetId) {
    const filteredRuns: typeof inPeriod = [];
    for (const run of inPeriod) {
      const wbImport = await findImportById(run.wb_import_id);
      if ((wbImport as any)?.cabinet_id === cabinetId) {
        filteredRuns.push(run);
      }
    }
    filtered = filteredRuns;
    label = `кабинет ${cabinetId.slice(0, 8)}`;
  }

  if (filtered.length === 0) {
    await ctx.reply(`Нет завершённых сверок ${PERIOD_LABEL[period]}. Попробуйте другой период.`);
    return;
  }

  const runIds = filtered.map(r => r.id);

  try {
    const result = await buildSummaryWorkbook(runIds);
    const caption = [
      `Сводный отчёт: ${label}, ${PERIOD_LABEL[period]}`,
      `Кабинетов: ${result.cabinetTotals.length}, сверок: ${result.aggregates.length}`,
      `Ожидалось: ${toRubNumber(result.totalExpectedKopeks).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`,
      `Получено: ${toRubNumber(result.totalReceivedKopeks).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`,
      `Разница: ${toRubNumber(result.totalDiffKopeks).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`,
    ].join('\n');

    await sendDocument(
      user.telegram_id!,
      result.buffer,
      `Sverka_сводка_${label}_${period}_${Date.now()}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      caption,
    );

    // CTA: по каждой недоплате в периоде — кнопка "Текст претензии" (reuse claim.ts,
    // без изменений в нём). Ограничиваем список, чтобы не собрать клавиатуру
    // на полсотни кнопок при "вся история".
    const underpaid = result.aggregates
      .filter(a => a.status === 'UNDERPAID')
      .sort((x, y) => (y.diffKopeks > x.diffKopeks ? 1 : y.diffKopeks < x.diffKopeks ? -1 : 0));

    const MAX_CLAIM_BUTTONS = 8;
    if (underpaid.length > 0) {
      const shown = underpaid.slice(0, MAX_CLAIM_BUTTONS);
      const buttons = shown.map(a => [{
        text: `📩 ${a.cabinetName ?? 'Без кабинета'} (${a.periodFrom}–${a.periodTo}): ${toRubNumber(a.diffKopeks).toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ₽`,
        callback_data: `claim_text:${a.runId}`,
      }]);

      let text = `Найдено недоплат: ${underpaid.length}. Можно сразу сформировать текст претензии:`;
      if (underpaid.length > MAX_CLAIM_BUTTONS) {
        text += `\n\nПоказаны ${MAX_CLAIM_BUTTONS} крупнейших — остальные см. в файле, лист «Детализация».`;
      }

      await ctx.reply(text, { reply_markup: { inline_keyboard: buttons } });
    }
  } catch (err) {
    console.error('[summaryExport] error:', err);
    await ctx.reply('Не удалось сформировать сводный отчёт. Попробуйте позже.');
  }
}
