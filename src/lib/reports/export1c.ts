// src/lib/reports/export1c.ts
//
// Реестр расхождений для 1С: ОДНА строка = ОДНА сверка (один run) — те же
// причины, что и в exportCsv.ts (движок не даёт попарного сопоставления
// WB-строк и банковских операций, поэтому построчный "per-платёж" формат
// вводил в заблуждение).
//
// Исправлено по сравнению с прошлой версией:
// - "Документ/Основание" теперь ссылается на реальный источник расхождения
//   (период WB-отчёта + кабинет), а не на id банковской операции — банковский
//   id не является документом-основанием для акта сверки в 1С.
// - Суммы форматируются как рубли с запятой через formatRub() (целочисленная
//   арифметика над копейками), а не через String(Number) — раньше это давало
//   разделитель "." вместо "," и потенциальные ошибки плавающей точки.
// - Текстовые поля проходят через csvCell() — раньше эта функция была
//   объявлена, но нигде не вызывалась, и спецсимволы в описании банковской
//   операции могли сломать структуру файла.

import { getRunAggregates, formatRub, csvCell, fmtDate, COUNTERPARTY_BY_MARKETPLACE } from './runAggregates';

const SEP = ';';
const HEADER = [
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

const EXPLANATION_ROW = [
  '# Сверка выплат Wildberries (SverkaBot)',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
];

export async function build1cForRun(runId: string): Promise<Buffer> {
  const agg = await getRunAggregates(runId);

  const counterparty = COUNTERPARTY_BY_MARKETPLACE[agg.marketplace] ?? COUNTERPARTY_BY_MARKETPLACE.WB;

  const periodLabel = agg.periodFrom && agg.periodTo ? `${agg.periodFrom} – ${agg.periodTo}` : '';
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

  const lines = [
    EXPLANATION_ROW.join(SEP),
    HEADER.join(SEP),
    row.join(SEP),
  ];
  return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf-8');
}
