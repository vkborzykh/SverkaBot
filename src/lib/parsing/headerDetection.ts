// src/lib/parsing/headerDetection.ts
// Locates the real table header (skipping preamble) and resolves columns by name.

import iconv from 'iconv-lite';
import * as XLSX from 'xlsx';
import { detectDelimiter, splitCsvLine } from '@/src/lib/ingestion/validate';

export type BankColumnRole =
  | 'date' | 'valueDate' | 'amount' | 'debit' | 'credit'
  | 'counterparty' | 'inn' | 'purpose' | 'docNumber' | 'currency' | 'account';

// Order matters: `account` is checked before `counterparty` so that
// "Счёт контрагента" is consumed as an (ignored) account column and does not
// steal the counterparty role from "Наименование контрагента".
const SYNONYMS: Record<BankColumnRole, RegExp[]> = {
  date:         [/дата\s*операц/i, /дата\s*документ/i, /дата\s*проводк/i, /дата\s*валютир/i, /дата\s*платеж/i, /^дата$/i, /operation\s*date/i, /^date$/i],
  valueDate:    [/дата\s*обработк/i, /дата\s*зачислен/i, /дата\s*списан/i],
  amount:       [/сумма\s*операц/i, /сумма\s*платеж/i, /сумма\s*в\s*валюте/i, /^сумма$/i, /^amount$/i],
  debit:        [/сумма\s*по\s*дебет/i, /^дебет$/i, /^расход/i, /^списани/i, /^debit$/i, /outflow/i],
  credit:       [/сумма\s*по\s*кредит/i, /^кредит$/i, /^приход/i, /^поступлени/i, /^зачислени/i, /^credit$/i, /inflow/i],
  account:      [/счёт\s*(контрагент|получател|плательщик|отправит)/i, /счет\s*(контрагент|получател|плательщик|отправит)/i, /номер\s*сч[её]та/i, /р\/с/i, /^сч[её]т$/i],
  counterparty: [/наименование\s*(получател|плательщик|контрагент|организац)/i, /контрагент/i, /плательщик/i, /получател/i, /корреспондент/i, /counterparty/i, /payer/i, /payee/i],
  inn:          [/^инн/i, /инн\s*контрагент/i, /tax\s*id/i],
  purpose:      [/назначен/i, /основани\s*(для\s*)?оплат/i, /^описание/i, /коммент/i, /purpose/i, /description/i, /details/i],
  docNumber:    [/номер\s*документ/i, /№\s*документ/i, /референс/i, /reference/i, /doc(ument)?\s*(no|number|№)/i, /^номер$/i, /^№$/i],
  currency:     [/валюта/i, /^currency$/i, /^cur$/i],
};

export interface ResolvedColumns {
  date: number | null; amount: number | null; debit: number | null; credit: number | null;
  counterparty: number | null; inn: number | null; purpose: number | null;
  docNumber: number | null; currency: number | null;
}

/** Низкоуровневый результат detectHeader() — индексы колонок в уже распарсенных
 *  строках. Используется напрямую parseBank.ts (там своя обработка ошибок по
 *  `missing`), поэтому форма не меняется. Не путать с публичным
 *  HeaderDetectionResult ниже — это разные контракты для разных потребителей. */
export interface RawHeaderDetection {
  ok: boolean;
  headerRowIndex: number;          // -1 if not found
  columns: ResolvedColumns;
  missing: BankColumnRole[];       // for failure_reason diagnostics
}

function roleForCell(text: string): BankColumnRole | null {
  const t = text.trim();
  if (!t) return null;
  for (const role of Object.keys(SYNONYMS) as BankColumnRole[]) {
    if (SYNONYMS[role].some((re) => re.test(t))) return role;
  }
  return null;
}

function scoreRow(cells: string[]): Map<BankColumnRole, number> {
  const roles = new Map<BankColumnRole, number>();
  cells.forEach((cell, idx) => {
    const role = roleForCell(String(cell ?? ''));
    if (role && !roles.has(role)) roles.set(role, idx);
  });
  return roles;
}

/**
 * Choose the row that most looks like a table header. A valid header must expose
 * a date column AND (a single amount column OR a debit/credit column). Everything
 * above the chosen row is preamble.
 */
export function detectHeader(rows: string[][], maxScan = 25): RawHeaderDetection {
  let best = { index: -1, score: 0, roles: new Map<BankColumnRole, number>() };

  const limit = Math.min(rows.length, maxScan);
  for (let i = 0; i < limit; i++) {
    const roles = scoreRow(rows[i] ?? []);
    const hasDate = roles.has('date');
    const hasMoney = roles.has('amount') || roles.has('debit') || roles.has('credit');
    if (hasDate && hasMoney && roles.size > best.score) best = { index: i, score: roles.size, roles };
  }

  const columns: ResolvedColumns = {
    date: null, amount: null, debit: null, credit: null,
    counterparty: null, inn: null, purpose: null, docNumber: null, currency: null,
  };
  const missing: BankColumnRole[] = [];

  if (best.index === -1) {
    missing.push('date', 'amount');
    return { ok: false, headerRowIndex: -1, columns, missing };
  }
  for (const [role, idx] of best.roles) {
    if (role in columns) (columns as unknown as Record<string, number | null>)[role] = idx; // ignores account/valueDate
  }
  if (columns.date === null) missing.push('date');
  if (columns.amount === null && columns.debit === null && columns.credit === null) missing.push('amount');

  return { ok: missing.length === 0, headerRowIndex: best.index, columns, missing };
}

// ── Публичный, обогащённый контракт для профилей банковских выписок ──────────
// (src/lib/profiles/resolve.ts, src/lib/profiles/draft.ts)

export interface ColumnMapping {
  dateColumn: string;
  amountColumn: string;
  descriptionColumn?: string;
  counterpartyColumn?: string;
  referenceColumn?: string;
}

export interface HeaderDetectionResult {
  headerRowIndex: number;
  columnMapping: ColumnMapping;
  dateFormat: string;   // 'DD.MM.YYYY' | 'YYYY-MM-DD' | 'DD/MM/YYYY'
  amountFormat: string; // 'space_comma' | 'comma' | 'dot' | 'dot_comma'
  confidence: number;   // 0..1
  signature: string;    // стабильный отпечаток шапки для сопоставления с profiles
}

function readXlsxRows(buf: Buffer): string[][] {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '' });
  return rows.map((r) => (r ?? []).map((c) => (c === null || c === undefined ? '' : String(c))));
}

function readCsvRows(buf: Buffer): string[][] {
  // Тот же приём, что и в validateContent.ts: пробуем UTF-8, и если кириллицы
  // не нашлось (типичный признак битой кодировки), откатываемся на Windows-1251.
  const utf8Str = iconv.decode(buf, 'utf-8');
  const hasCyrillic = /[а-яА-ЯёЁ]/.test(utf8Str);
  const str = hasCyrillic ? utf8Str : iconv.decode(buf, 'windows-1251');

  const delimiter = detectDelimiter(str);
  return str
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => splitCsvLine(line, delimiter));
}

function firstDataValue(rows: string[][], headerRowIndex: number, colIdx: number | null): string {
  if (colIdx === null) return '';
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const v = rows[i]?.[colIdx];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function detectDateFormat(sample: string): string {
  const s = sample.trim();
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) return 'DD.MM.YYYY';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'YYYY-MM-DD';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return 'DD/MM/YYYY';
  return 'DD.MM.YYYY'; // разумный дефолт для российских банковских выписок
}

function detectAmountFormat(sample: string): string {
  const s = sample.trim();
  // тысячный разделитель — пробел (обычный/неразрывный), десятичный — запятая
  if (/^-?\d{1,3}([ \u00A0]\d{3})*,\d{2}$/.test(s)) return 'space_comma';
  // тысячный разделитель — точка, десятичный — запятая (европейский формат, напр. Тинькофф "1.500,00")
  if (/^-?\d{1,3}(\.\d{3})+,\d{2}$/.test(s)) return 'dot_comma';
  if (/^-?\d+,\d{2}$/.test(s)) return 'comma';
  if (/^-?\d+\.\d{2}$/.test(s)) return 'dot';
  return 'dot';
}

/**
 * Высокоуровневая детекция для профилей банковских выписок: разбирает сырой
 * файл (XLSX/CSV, с автоопределением кодировки и разделителя для CSV),
 * находит шапку таблицы, резолвит колонки по именам и строит сигнатуру для
 * сопоставления с сохранёнными профилями (см. profiles/resolve.ts).
 *
 * Возвращает null, если таблицу с шапкой найти не удалось (см. Fixture 5 в
 * headerDetection.test.ts — файл со свободным текстом без таблицы).
 */
export async function detectHeaderAndColumns(
  buf: Buffer,
  fileType: 'xlsx' | 'csv',
): Promise<HeaderDetectionResult | null> {
  const rows = fileType === 'xlsx' ? readXlsxRows(buf) : readCsvRows(buf);
  const raw = detectHeader(rows);
  if (!raw.ok) return null;

  const headerRow = rows[raw.headerRowIndex] ?? [];
  const cellText = (idx: number | null): string => (idx === null ? '' : String(headerRow[idx] ?? '').trim());

  const amountIdx = raw.columns.amount ?? raw.columns.debit ?? raw.columns.credit;

  const columnMapping: ColumnMapping = {
    dateColumn: cellText(raw.columns.date),
    amountColumn: cellText(amountIdx),
  };
  const descriptionColumn = cellText(raw.columns.purpose);
  const counterpartyColumn = cellText(raw.columns.counterparty);
  const referenceColumn = cellText(raw.columns.docNumber);
  if (descriptionColumn) columnMapping.descriptionColumn = descriptionColumn;
  if (counterpartyColumn) columnMapping.counterpartyColumn = counterpartyColumn;
  if (referenceColumn) columnMapping.referenceColumn = referenceColumn;

  const EXTRA_ROLES = ['counterparty', 'purpose', 'docNumber', 'currency'] as const;
  const matchedExtra = EXTRA_ROLES.filter((r) => raw.columns[r] !== null).length;
  const confidence = Math.min(1, 0.65 + 0.1 * matchedExtra);

  const dateFormat = detectDateFormat(firstDataValue(rows, raw.headerRowIndex, raw.columns.date));
  const amountFormat = detectAmountFormat(firstDataValue(rows, raw.headerRowIndex, amountIdx));

  const signature = headerRow
    .map((c) => String(c ?? '').trim().toLowerCase())
    .filter(Boolean)
    .join('|');

  return {
    headerRowIndex: raw.headerRowIndex,
    columnMapping,
    dateFormat,
    amountFormat,
    confidence,
    signature,
  };
}
