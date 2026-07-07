const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_TYPES = ['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream'];
const BANK_STATEMENT_HASH_SIGNATURES = [
  'выписка', 'выписк', 'платёж', 'платеж', 'операци', 'контрагент',
  'bank statement', 'transaction', 'statement', 'account activity'
];
const HASH_SAMPLE_LINES = 30;

export type CsvDelimiter = ';' | ',' | '\t';
const CANDIDATE_DELIMITERS: CsvDelimiter[] = [';', ',', '\t'];

/** Quote-aware split of one CSV line. */
export function splitCsvLine(line: string, delimiter: CsvDelimiter): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * Detect delimiter by column-count consistency AND width.
 * Fix: the score must reward the number of columns, not only agreement.
 * A file like VTB ("1 234,56" decimal comma + a 5-row preamble) otherwise makes
 * ',' win with a perfectly-consistent-but-degenerate 2-column split, shredding
 * every row. `modalCols * agreement` makes the real ';' (10 columns) win.
 */
export function detectDelimiter(text: string, override?: CsvDelimiter): CsvDelimiter {
  if (override) return override;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 40);
  if (lines.length === 0) return ';';
  const total = lines.length;

  let best = { delim: ';' as CsvDelimiter, score: -1 };
  for (const delim of CANDIDATE_DELIMITERS) {
    const freq = new Map<number, number>();
    for (const line of lines) {
      const cols = splitCsvLine(line, delim).length;
      if (cols >= 2) freq.set(cols, (freq.get(cols) ?? 0) + 1);
    }
    if (freq.size === 0) continue;

    let modalCols = 0, modalHits = 0;
    for (const [cols, hits] of freq) {
      if (hits > modalHits || (hits === modalHits && cols > modalCols)) { modalHits = hits; modalCols = cols; }
    }
    const score = modalCols * (modalHits / total);
    if (score > best.score) best = { delim, score };
  }
  return best.delim;
}

export function validateExtension(filename: string): boolean {
  const allowed = ['csv', 'txt', 'xlsx'];
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? allowed.includes(ext) : false;
}

export function validateFile(file: File): { valid: boolean; error?: string } {
  if (file.size === 0) return { valid: false, error: 'Файл пуст' };
  if (file.size > MAX_FILE_SIZE_BYTES) return { valid: false, error: `Файл слишком большой (макс. ${MAX_FILE_SIZE_BYTES / 1024 / 1024} МБ)` };
  if (!validateExtension(file.name)) return { valid: false, error: 'Неподдерживаемый формат. Загрузите XLSX или CSV.' };
  return { valid: true };
}

export function looksLikeBankStatement(text: string): boolean {
  const head = text.split(/\r?\n/).slice(0, HASH_SAMPLE_LINES).join(' ').toLowerCase();
  return BANK_STATEMENT_HASH_SIGNATURES.some((sig) => head.includes(sig));
}
