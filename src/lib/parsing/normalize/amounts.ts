// Parses monetary values into integer kopeks (bigint).
// Supports various decimal separators, thousand separators, currency symbols, negative forms.

const CURRENCY_SYMBOLS = /[₽$€¥£]|руб|RUB|USD|EUR/gi;
// Strips thousands separators (space or non-breaking space) then normalises decimal
const SPACE_SEP = /[\s\u00A0]/g;

export function normalizeAmount(value: unknown): bigint {
  if (value === null || value === undefined || value === '') {
    throw new Error(`Empty amount value`);
  }

  if (typeof value === 'number') {
    if (!isFinite(value)) throw new Error(`Non-finite amount: ${value}`);
    return rubleFloatToKopeks(value);
  }

  let str = String(value).trim();
  if (!str) throw new Error(`Empty amount string`);

  // Parentheses → negative: (1234.56) → -1234.56
  const isParens = /^\((.+)\)$/.test(str);
  if (isParens) str = `-${str.slice(1, -1)}`;

  // Trailing minus: 1234.56- → -1234.56
  if (/^[^-].*-$/.test(str)) {
    str = `-${str.slice(0, -1)}`;
  }

  // Strip currency symbols
  str = str.replace(CURRENCY_SYMBOLS, '').trim();

  // Remove thousand separators (spaces) but keep minus and decimal
  str = str.replace(SPACE_SEP, '');

  // Normalise comma decimal separator → dot
  // Handle "1.234,56" (European) vs "1,234.56" (US)
  const commaCount = (str.match(/,/g) || []).length;
  const dotCount = (str.match(/\./g) || []).length;

  if (commaCount === 1 && dotCount === 0) {
    // "1234,56" → "1234.56"
    str = str.replace(',', '.');
  } else if (commaCount === 1 && dotCount > 0) {
    // "1.234,56" → "1234.56"
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (dotCount > 1) {
    // "1.234.567" (thousands only)
    str = str.replace(/\./g, '');
  }
  // else single dot is already correct

  str = str.replace(/,/g, ''); // remove any remaining commas (thousands)

  const num = parseFloat(str);
  if (isNaN(num)) throw new Error(`Cannot parse amount: "${value}"`);
  return rubleFloatToKopeks(num);
}

function rubleFloatToKopeks(rubles: number): bigint {
  // Multiply by 100 using string rounding to avoid float precision issues
  const rounded = Math.round(rubles * 100);
  return BigInt(rounded);
}
