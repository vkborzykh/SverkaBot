// src/lib/reports/export1c.ts
//
// Реестр расхождений для 1С.
//
// Формат: если движок сверки нашёл конкретные непокрытые WB-строки с высокой
// уверенностью (см. claimBuilder.ts — сверено с агрегатом, допуск 5%/500 ₽),
// выгружаем РЕЕСТР — одна строка на каждую непокрытую выплату, пригодный для
// разнесения отдельными проводками. Иначе — старое поведение: одна строка на
// весь run (агрегат), потому что построчных данных с достаточной
// уверенностью нет.
//
// Пояснительный текст для человека НЕ включается в сам файл (в отличие от
// XLSX/HTML) — это машиночитаемый формат для импорта в 1С, и лишняя строка
// перед заголовками ломает автоматическое сопоставление колонок. Контекст
// для бухгалтера передаётся в подписи к файлу в Telegram (см. exportBusiness.ts).
//
// Исправлено по сравнению с прошлыми версиями:
// - "Документ/Основание" ссылается на реальный источник расхождения (период
//   WB-отчёта + кабинет, либо конкретная WB-строка в построчном режиме), а
//   не на id банковской операции.
// - Суммы форматируются как рубли с запятой через formatRub() (целочисленная
//   арифметика над копейками), а не через String(Number).
// - Текстовые поля проходят через csvCell().

import { getRunAggregates, formatRub, csvCell, fmtDate, COUNTERPARTY_BY_MARKETPLACE } from './runAggregates';
import { buildRowLevelClaim } from '@/src/lib/reconciliation/claimBuilder';

const SEP = ';';

const HEADER_AGGREGATE = [
  'ID сверки',
  'Дата сверки',
  'Кабинет WB',
  'Период отчёта WB',
  'Контрагент',
  'Документ-основание',
  'Ожидалось, руб.',
  'Получено, руб.',
  'Разница, руб.',
  'Статус',
];

const HEADER_ROW_LEVEL = [
  'ID сверки',
  'Дата сверки',
  'Кабинет WB',
  'Дата начисления WB',
  'Контрагент',
  'Документ-основание',
  'Не подтверждено, руб.',
  'Статус',
];

export async function build1cForRun(runId: string): Promise<Buffer> {
  const agg = await getRunAggregates(runId);

  const counterparty = COUNTERPARTY_BY_MARKETPLACE[agg.marketplace] ?? COUNTERPARTY_BY_MARKETPLACE.WB;
  const periodLabel = agg.periodFrom && agg.periodTo ? `${agg.periodFrom} – ${agg.periodTo}` : '';

  const claim = agg.diffKopeks > BigInt(0)
    ? await buildRowLevelClaim(agg.runId, agg.wbTxs, agg.diffKopeks)
    : null;

  if (claim && claim.confidence === 'high' && claim.rows.length > 0) {
    const rows = claim.rows.map((r) => [
      agg.runId,
      fmtDate(agg.createdAt),
      csvCell(agg.cabinetName ?? ''),
      r.dateStr,
      csvCell(counterparty),
      csvCell(r.reference || r.description || `Отчёт WB за период ${periodLabel}`),
      formatRub(r.amountKopeks),
      'Не подтверждено',
    ]);
    const lines = [HEADER_ROW_LEVEL.join(SEP), ...rows.map((r) => r.join(SEP))];
    return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8');
  }

  // Fallback: агрегат на весь run (нет данных для построчной разбивки,
  // либо низкая уверенность, либо недоплаты нет вовсе)
  const basisDocument = [
    `Отчёт WB за период ${periodLabel}`,
    agg.cabinetName ? `кабинет «${agg.cabinetName}»` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const row = [
    agg.runId,
    fmtDate(agg.createdAt),
    csvCell(agg.cabinetName ?? ''),
    periodLabel,
    csvCell(counterparty),
    csvCell(basisDocument),
    formatRub(agg.expectedKopeks),
    formatRub(agg.receivedKopeks),
    formatRub(agg.diffKopeks),
    agg.statusLabel,
  ];

  const lines = [HEADER_AGGREGATE.join(SEP), row.join(SEP)];
  return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8');
}

