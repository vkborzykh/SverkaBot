// Parses date strings or Excel serial numbers into a UTC Date.
// Supported formats: DD.MM.YYYY, DD.MM.YYYY HH:MM:SS, YYYY-MM-DD, YYYY/MM/DD, Excel serial.

const EXCEL_EPOCH = new Date(Date.UTC(1899, 11, 30)); // 30 Dec 1899

export function normalizeDate(value: unknown): Date {
  if (value === null || value === undefined || value === '') {
    throw new Error(`Empty date value`);
  }

  // Excel serial number (numeric)
  if (typeof value === 'number') {
    if (!isFinite(value) || value < 0) throw new Error(`Invalid Excel serial: ${value}`);
    const ms = Math.round(value) * 86400000;
    const d = new Date(EXCEL_EPOCH.getTime() + ms);
    if (isNaN(d.getTime())) throw new Error(`Cannot convert Excel serial ${value}`);
    return d;
  }

  const str = String(value).trim();

  if (!str) throw new Error(`Empty date string`);

  // DD.MM.YYYY or DD.MM.YYYY HH:MM:SS
  const dmyMatch = str.match(
    /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/,
  );
  if (dmyMatch) {
    const [, d, m, y, hh = '0', mm = '0', ss = '0'] = dmyMatch;
    const date = new Date(
      Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss),
    );
    if (isNaN(date.getTime())) throw new Error(`Invalid date: ${str}`);
    return date;
  }

  // YYYY-MM-DD or YYYY/MM/DD (with optional time)
  const isoMatch = str.match(
    /^(\d{4})[-\/](\d{2})[-\/](\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (isoMatch) {
    const [, y, m, d, hh = '0', mm = '0', ss = '0'] = isoMatch;
    const date = new Date(
      Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss),
    );
    if (isNaN(date.getTime())) throw new Error(`Invalid date: ${str}`);
    return date;
  }

  throw new Error(`Unrecognized date format: "${str}"`);
}
