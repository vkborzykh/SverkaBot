// Normalises text fields: lowercase, trim, collapse multiple spaces.

export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}
