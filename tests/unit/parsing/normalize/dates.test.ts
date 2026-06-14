import { describe, it, expect } from 'vitest';
import { normalizeDate } from '@/src/lib/parsing/normalize/dates';

describe('normalizeDate', () => {
  it('parses DD.MM.YYYY', () => {
    const d = normalizeDate('15.03.2025');
    expect(d.toISOString()).toBe('2025-03-15T00:00:00.000Z');
  });

  it('parses DD.MM.YYYY HH:MM:SS', () => {
    const d = normalizeDate('01.01.2024 14:30:00');
    expect(d.toISOString()).toBe('2024-01-01T14:30:00.000Z');
  });

  it('parses YYYY-MM-DD', () => {
    const d = normalizeDate('2025-06-01');
    expect(d.toISOString()).toBe('2025-06-01T00:00:00.000Z');
  });

  it('parses YYYY/MM/DD', () => {
    const d = normalizeDate('2025/12/31');
    expect(d.toISOString()).toBe('2025-12-31T00:00:00.000Z');
  });

  it('parses ISO with time', () => {
    const d = normalizeDate('2025-03-15T09:00:00');
    expect(d.toISOString()).toBe('2025-03-15T09:00:00.000Z');
  });

  it('parses Excel serial number (integer)', () => {
    // Excel serial 45000 = 2023-03-15
    const d = normalizeDate(45000);
    expect(d instanceof Date).toBe(true);
    expect(d.getUTCFullYear()).toBe(2023);
  });

  it('parses Excel serial 1 = 1899-12-31', () => {
    const d = normalizeDate(1);
    expect(d.getUTCFullYear()).toBe(1899);
  });

  it('throws on empty string', () => {
    expect(() => normalizeDate('')).toThrow();
  });

  it('throws on null', () => {
    expect(() => normalizeDate(null)).toThrow();
  });

  it('throws on unrecognised format', () => {
    expect(() => normalizeDate('March 15, 2025')).toThrow(/Unrecognized/i);
  });

  it('throws on negative Excel serial', () => {
    expect(() => normalizeDate(-1)).toThrow();
  });
});
