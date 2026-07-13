// Normalises text fields: lowercase, trim, collapse multiple spaces.

export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Приводит текст к единому виду без смены регистра.
 * Используется для полей, которые показываются пользователю в экспорте/UI
 * (description, counterparty, reference) — там нижний регистр не несёт
 * пользы для сопоставления, но портит читаемость для бухгалтера.
 */
export function normalizeDisplayText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ');
}
