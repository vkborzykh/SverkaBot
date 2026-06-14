import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import iconv from 'iconv-lite';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ColumnMapping {
  dateColumn: string | number;
  amountColumn: string | number;
  descriptionColumn?: string | number;
  counterpartyColumn?: string | number;
  referenceColumn?: string | number;
}

export type AmountFormat = 'dot' | 'comma' | 'space_comma' | 'european_dot';

export interface HeaderDetectionResult {
  headerRowIndex: number;
  columnMapping: ColumnMapping;
  dateFormat: string;
  amountFormat: AmountFormat;
  confidence: number;
  signature: string;
}

// ── Keyword lists ─────────────────────────────────────────────────────────────

const DATE_KW = [
  'дата', 'date', 'дата операции', 'дата проводки', 'operation date',
  'дата транзакции', 'дата платежа', 'дата выписки',
];
const AMOUNT_KW = [
  'сумма', 'amount', 'приход', 'расход', 'дебет', 'кредит',
  'debit', 'credit', 'withdrawal', 'deposit', 'сумма операции',
  'к выплате', 'итоговая сумма', 'оборот',
];
const DESCRIPTION_KW = [
  'назначение', 'description', 'назначение платежа', 'описание',
  'purpose', 'наименование', 'детали', 'примечание',
];
const COUNTERPARTY_KW = [
  'контрагент', 'плательщик', 'получатель', 'counterparty',
  'payer', 'payee', 'организация', 'клиент',
];
const REFERENCE_KW = [
  'номер', 'документ', 'reference', 'document number', 'ref',
  'номер документа', '№', 'id', 'ид', 'номер операции',
];
const PENALTY_KW = [
  'остаток', 'итого', 'balance', 'total', 'входящий остаток',
  'начальный остаток', 'исходящий остаток', 'конечный остаток',
  'итоговый', 'промежуточный итог',
];

const MIN_CONFIDENCE = 0.3;
const SAMPLE_ROWS = 30;
const MAX_HEADER_CANDIDATE = 25;
const DATE_SAMPLE_ROWS = 5;

// ── Date / amount detection patterns ─────────────────────────────────────────

const DATE_PATTERNS: Array<{ regex: RegExp; format: string }> = [
  { regex: /^\d{2}\.\d{2}\.\d{4}(\s+\d{2}:\d{2}(:\d{2})?)?$/, format: 'DD.MM.YYYY' },
  { regex: /^\d{2}\.\d{2}\.\d{2}$/, format: 'DD.MM.YY' },
  { regex: /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/, format: 'YYYY-MM-DD' },
  { regex: /^\d{4}\/\d{2}\/\d{2}$/, format: 'YYYY/MM/DD' },
  { regex: /^\d{2}\/\d{2}\/\d{4}$/, format: 'DD/MM/YYYY' },
  { regex: /^\d{1,2}\.\d{2}\.\d{4}$/, format: 'D.MM.YYYY' },
];

// ── Low-level helpers ─────────────────────────────────────────────────────────

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function normalizeCell(v: unknown): string {
  return cellStr(v).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Score a single candidate row's cells against keyword lists. Returns 0–1. */
function scoreCandidateRow(
  cells: unknown[],
): {
  score: number;
  dateIdx: number | null;
  amountIdx: number | null;
  descIdx: number | null;
  cpIdx: number | null;
  refIdx: number | null;
  penalty: number;
} {
  let score = 0;
  let dateIdx: number | null = null;
  let amountIdx: number | null = null;
  let descIdx: number | null = null;
  let cpIdx: number | null = null;
  let refIdx: number | null = null;
  let penalty = 0;
  let nonEmpty = 0;

  for (let ci = 0; ci < cells.length; ci++) {
    const norm = normalizeCell(cells[ci]);
    if (!norm) continue;
    nonEmpty++;

    const exactMatch = (kws: string[]) => kws.some((k) => norm === k);
    const partialMatch = (kws: string[]) => kws.some((k) => norm.includes(k));

    if ((dateIdx === null) && partialMatch(DATE_KW)) {
      score += exactMatch(DATE_KW) ? 0.35 : 0.2;
      dateIdx = ci;
    }
    if ((amountIdx === null) && partialMatch(AMOUNT_KW)) {
      score += exactMatch(AMOUNT_KW) ? 0.35 : 0.2;
      amountIdx = ci;
    }
    if ((descIdx === null) && partialMatch(DESCRIPTION_KW)) {
      score += 0.1;
      descIdx = ci;
    }
    if ((cpIdx === null) && partialMatch(COUNTERPARTY_KW)) {
      score += 0.05;
      cpIdx = ci;
    }
    if ((refIdx === null) && partialMatch(REFERENCE_KW)) {
      score += 0.05;
      refIdx = ci;
    }
    if (partialMatch(PENALTY_KW)) {
      penalty += 0.5;
    }
  }

  // Bonus for having both required fields
  if (dateIdx !== null && amountIdx !== null) score += 0.15;
  // Bonus for non-trivial rows
  if (nonEmpty >= 3) score += 0.05;

  return { score, dateIdx, amountIdx, descIdx, cpIdx, refIdx, penalty };
}

/** Attempt to parse a string as a number; return true on success. */
function looksNumeric(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false;
  if (typeof v === 'number') return isFinite(v);
  const s = String(v).trim().replace(/[₽$€\s]/g, '').replace(',', '.');
  return !isNaN(parseFloat(s)) && isFinite(Number(s.replace(/\./g, '').replace(',', '.')));
}

/** Attempt to parse a string as a date. */
function looksDate(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false;
  if (typeof v === 'number') return v > 0 && v < 100000; // Excel serial
  const s = String(v).trim();
  return DATE_PATTERNS.some((p) => p.regex.test(s));
}

/** Score how parseable the data rows below a candidate header are. */
function scoreDataRows(
  rows: unknown[][],
  dateIdx: number,
  amountIdx: number,
): number {
  const sample = rows.slice(0, 10).filter((r) => r.some((c) => c !== null && c !== ''));
  if (sample.length === 0) return 0;
  let ok = 0;
  for (const row of sample) {
    const dateOk = looksDate(row[dateIdx]);
    const amountOk = looksNumeric(row[amountIdx]);
    if (dateOk && amountOk) ok++;
  }
  return ok / sample.length;
}

// ── Date format detection ─────────────────────────────────────────────────────

function detectDateFormat(rows: unknown[][], colIdx: number): string {
  const samples: string[] = [];
  for (const row of rows) {
    const v = cellStr(row[colIdx]);
    if (v) samples.push(v);
    if (samples.length >= DATE_SAMPLE_ROWS) break;
  }
  for (const s of samples) {
    for (const p of DATE_PATTERNS) {
      if (p.regex.test(s)) return p.format;
    }
  }
  return 'DD.MM.YYYY'; // default for Russian statements
}

// ── Amount format detection ───────────────────────────────────────────────────

function detectAmountFormat(rows: unknown[][], colIdx: number): AmountFormat {
  for (const row of rows) {
    const v = cellStr(row[colIdx]);
    if (!v || typeof row[colIdx] === 'number') continue;

    // Must check space-comma BEFORE stripping spaces from the cleaned copy
    if (/[\s\u00A0]/.test(v) && /,\d{1,2}(\s|$)/.test(v)) return 'space_comma';

    const cleaned = v.replace(/[₽$€\s\u00A0]/g, '');
    // European: 1.234,56
    if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(cleaned)) return 'european_dot';
    // Plain comma decimal: 1234,56
    if (/\d,\d{1,2}$/.test(cleaned) && !/\./.test(cleaned)) return 'comma';
    // Dot decimal: 1234.56
    if (/\d\.\d{1,2}$/.test(cleaned)) return 'dot';
  }
  return 'dot';
}

// ── Signature generation ──────────────────────────────────────────────────────

function buildSignature(headerCells: unknown[]): string {
  const normalized = headerCells
    .map((c) => normalizeCell(c))
    .filter(Boolean)
    .sort()
    .join('|');
  return normalized.slice(0, 200);
}

// ── CSV parsing with encoding detection ──────────────────────────────────────

function parseCSVWithEncoding(buffer: Buffer, enc: string): unknown[][] {
  let str: string;
  try {
    str = iconv.decode(buffer, enc);
  } catch {
    return [];
  }
  const result = Papa.parse<string[]>(str, {
    header: false,
    skipEmptyLines: false,
    dynamicTyping: false,
  });
  return result.data as unknown[][];
}

/** Count how many cells in the first 4 rows contain recognisable Cyrillic text. */
function cyrillicScore(rows: unknown[][]): number {
  let count = 0;
  for (const row of rows.slice(0, 4)) {
    for (const cell of row) {
      if (typeof cell === 'string' && /[а-яА-ЯёЁ]/.test(cell)) count++;
    }
  }
  return count;
}

function parseCSV(buffer: Buffer): unknown[][] {
  // Try both encodings; pick the one that yields more recognisable Cyrillic text
  const utf8Rows = parseCSVWithEncoding(buffer, 'utf-8');
  const win1251Rows = parseCSVWithEncoding(buffer, 'windows-1251');

  const utf8Score = cyrillicScore(utf8Rows);
  const win1251Score = cyrillicScore(win1251Rows);

  if (win1251Score > utf8Score) return win1251Rows;
  if (utf8Rows.length > 0) return utf8Rows;
  return win1251Rows;
}

// ── XLSX parsing ──────────────────────────────────────────────────────────────

function parseXLSX(buffer: Buffer): unknown[][] {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function detectHeaderAndColumns(
  fileBuffer: Buffer,
  fileType: 'csv' | 'xlsx',
): Promise<HeaderDetectionResult | null> {
  // 1. Parse raw rows
  const allRows = fileType === 'xlsx' ? parseXLSX(fileBuffer) : parseCSV(fileBuffer);
  if (allRows.length === 0) return null;

  const sampleRows = allRows.slice(0, SAMPLE_ROWS);

  // 2. Evaluate each candidate header row
  interface Candidate {
    rowIdx: number;
    score: number;
    dateIdx: number;
    amountIdx: number;
    descIdx: number | null;
    cpIdx: number | null;
    refIdx: number | null;
    dataScore: number;
  }

  const candidates: Candidate[] = [];

  for (let ri = 0; ri < Math.min(MAX_HEADER_CANDIDATE, sampleRows.length); ri++) {
    const row = sampleRows[ri];

    // Skip completely empty rows
    if (row.every((c) => c === null || cellStr(c) === '')) continue;

    const scored = scoreCandidateRow(row);

    // Must have both required columns to be a viable candidate
    if (scored.dateIdx === null || scored.amountIdx === null) continue;

    const dataRows = allRows.slice(ri + 1);
    const dataScore = scoreDataRows(dataRows, scored.dateIdx, scored.amountIdx);

    const finalScore = (scored.score - scored.penalty) * 0.6 + dataScore * 0.4;

    candidates.push({
      rowIdx: ri,
      score: finalScore,
      dateIdx: scored.dateIdx,
      amountIdx: scored.amountIdx,
      descIdx: scored.descIdx,
      cpIdx: scored.cpIdx,
      refIdx: scored.refIdx,
      dataScore,
    });
  }

  if (candidates.length === 0) return null;

  // 3. Pick best candidate
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Clamp confidence to [0, 1]
  const confidence = Math.min(1, Math.max(0, best.score));

  if (confidence < MIN_CONFIDENCE) return null;

  // 4. Extract header cells for the winning row
  const headerRow = sampleRows[best.rowIdx];
  const dataRows = allRows.slice(best.rowIdx + 1);

  // 5. Detect date/amount formats
  const dateFormat = detectDateFormat(dataRows, best.dateIdx);
  const amountFormat = detectAmountFormat(dataRows, best.amountIdx);

  // 6. Build signature from header cell values
  const signature = buildSignature(headerRow);

  // 7. Column names: use the header cell text if it's a string, else use index
  const colName = (idx: number): string | number => {
    const v = cellStr(headerRow[idx]);
    return v || idx;
  };

  const columnMapping: ColumnMapping = {
    dateColumn: colName(best.dateIdx),
    amountColumn: colName(best.amountIdx),
    ...(best.descIdx !== null && { descriptionColumn: colName(best.descIdx) }),
    ...(best.cpIdx !== null && { counterpartyColumn: colName(best.cpIdx) }),
    ...(best.refIdx !== null && { referenceColumn: colName(best.refIdx) }),
  };

  return {
    headerRowIndex: best.rowIdx,
    columnMapping,
    dateFormat,
    amountFormat,
    confidence,
    signature,
  };
}
