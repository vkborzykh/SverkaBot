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

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export function validateExtension(filename: string, allowed: string[]): boolean {
  const ext = filename.toLowerCase().split('.').pop();
  return !!ext && allowed.includes(`.${ext}`);
}

export function validateFileSize(size: number): boolean {
  return size <= MAX_FILE_BYTES;
}
