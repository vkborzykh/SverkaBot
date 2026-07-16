// src/lib/parsing/headerDetection.ts
// Locates the real table header (skipping preamble) and resolves columns by name.

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
  docNumber:    [/номер\s*документ/i, /№\s*документ/i, /референс/i, /reference/i, /doc(ument)?\s*(no|number|№)/i],
  currency:     [/валюта/i, /^currency$/i, /^cur$/i],
};

export interface ResolvedColumns {
  date: number | null; amount: number | null; debit: number | null; credit: number | null;
  counterparty: number | null; inn: number | null; purpose: number | null;
  docNumber: number | null; currency: number | null;
}
export interface HeaderDetectionResult {
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
export function detectHeader(rows: string[][], maxScan = 25): HeaderDetectionResult {
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
    if (role in columns) (columns as Record<string, number | null>)[role] = idx; // ignores account/valueDate
  }
  if (columns.date === null) missing.push('date');
  if (columns.amount === null && columns.debit === null && columns.credit === null) missing.push('amount');

  return { ok: missing.length === 0, headerRowIndex: best.index, columns, missing };
}
