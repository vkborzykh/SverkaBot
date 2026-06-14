import { describe, it, expect } from 'vitest';
import { normalizeAmount } from '@/src/lib/parsing/normalize/amounts';

describe('normalizeAmount', () => {
  it('parses integer rubles', () => {
    expect(normalizeAmount('1000')).toBe(100000n);
  });

  it('parses decimal with dot', () => {
    expect(normalizeAmount('1234.56')).toBe(123456n);
  });

  it('parses decimal with comma', () => {
    expect(normalizeAmount('1234,56')).toBe(123456n);
  });

  it('parses thousand-separated with space', () => {
    expect(normalizeAmount('1 234,56')).toBe(123456n);
  });

  it('parses European format 1.234,56', () => {
    expect(normalizeAmount('1.234,56')).toBe(123456n);
  });

  it('parses negative value with leading minus', () => {
    expect(normalizeAmount('-500.00')).toBe(-50000n);
  });

  it('parses negative value in parentheses', () => {
    expect(normalizeAmount('(250,00)')).toBe(-25000n);
  });

  it('parses value with ₽ symbol', () => {
    expect(normalizeAmount('1 500 ₽')).toBe(150000n);
  });

  it('parses numeric float', () => {
    expect(normalizeAmount(99.99)).toBe(9999n);
  });

  it('parses zero', () => {
    expect(normalizeAmount('0')).toBe(0n);
  });

  it('parses zero decimal 0,00', () => {
    expect(normalizeAmount('0,00')).toBe(0n);
  });

  it('throws on empty string', () => {
    expect(() => normalizeAmount('')).toThrow();
  });

  it('throws on null', () => {
    expect(() => normalizeAmount(null)).toThrow();
  });

  it('throws on non-numeric text', () => {
    expect(() => normalizeAmount('abc')).toThrow();
  });
});
