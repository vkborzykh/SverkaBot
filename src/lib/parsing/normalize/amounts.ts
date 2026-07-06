// Locale-tolerant monetary parsing. Returns integer kopeks (bigint), never float.

/**
 * Parse a raw cell into signed integer kopeks.
 * Handles: "1234,56", "1 234,56", "1234.56", "1,234.56", "1.234,56",
 *          "-1234,56", "1234,56-", "(1 234,56)", "1 234 567,89", "1234",
 *          и числовые ячейки XLSX (561.43).
 * Returns null when the value is not a number.
 */
export function parseAmountToKopeks(raw: unknown): bigint | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'number' && Number.isFinite(raw)) return numberToKopeks(raw);
  if (typeof raw === 'bigint') return raw * 100n; // bare bigint assumed to be rubles

  let s = String(raw).trim();
  if (s === '' || s === '-' || s === '—' || s === '–') return null;

  // Sign: leading/trailing minus (ASCII/Unicode) or parentheses.
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/[-\u2212]/.test(s)) negative = true;

  // Keep only digits and separators (strips spaces, NBSP, ₽, letters, signs, parens).
  s = s.replace(/[^\d.,]/g, '');
  if (s === '') return null;

  const decPos = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  let intPart: string;
  let fracPart: string;

  if (decPos === -1) {
    intPart = s;
    fracPart = '';
  } else {
    const after = s.slice(decPos + 1);
    if (/^\d{1,2}$/.test(after)) {
      // Rightmost separator with 1–2 trailing digits = decimal separator.
      intPart = s.slice(0, decPos).replace(/[.,]/g, '');
      fracPart = after;
    } else {
      // All separators are thousands groupings → integer amount.
      intPart = s.replace(/[.,]/g, '');
      fracPart = '';
    }
  }

  if (intPart === '') intPart = '0';
  if (!/^\d+$/.test(intPart)) return null;

  fracPart = (fracPart + '00').slice(0, 2);
  const kopeks = BigInt(intPart) * 100n + BigInt(fracPart);
  return negative ? -kopeks : kopeks;
}

/** Convert a float ruble value to kopeks without binary-float drift. */
function numberToKopeks(value: number): bigint {
  const negative = value < 0;
  const [int, frac = '00'] = Math.abs(value).toFixed(2).split('.');
  const kopeks = BigInt(int) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2));
  return negative ? -kopeks : kopeks;
}
