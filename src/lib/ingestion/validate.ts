export type CsvDelimiter = ';' | ',' | '\t';

const CANDIDATE_DELIMITERS: CsvDelimiter[] = [';', ',', '\t'];

/** Quote-aware split of a single CSV line (used for counting and parsing). */
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
 * Detect the delimiter by column-count consistency across sampled lines.
 * Robust against comma-decimal numbers ("1234,56") that fool naive detectors
 * into choosing ',' on a TAB/semicolon file.
 */
export function detectDelimiter(text: string, override?: CsvDelimiter): CsvDelimiter {
  if (override) return override;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 40);
  if (lines.length === 0) return ';';

  let best = { delim: ';' as CsvDelimiter, score: -1 };
  for (const delim of CANDIDATE_DELIMITERS) {
    const counts = lines.map((l) => splitCsvLine(l, delim).length).filter((c) => c >= 2);
    if (counts.length === 0) continue;

    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    let modalCols = 1, modalHits = 0;
    for (const [c, hits] of freq) {
      if (hits > modalHits || (hits === modalHits && c > modalCols)) { modalHits = hits; modalCols = c; }
    }
    const score = (modalHits / counts.length) * 100 + modalCols;
    if (modalCols >= 2 && score > best.score) best = { delim, score };
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
