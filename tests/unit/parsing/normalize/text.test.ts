import { describe, it, expect } from 'vitest';
import { normalizeText } from '@/src/lib/parsing/normalize/text';

describe('normalizeText', () => {
  it('lowercases', () => {
    expect(normalizeText('HELLO')).toBe('hello');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeText('  hello  ')).toBe('hello');
  });

  it('collapses multiple spaces', () => {
    expect(normalizeText('foo   bar')).toBe('foo bar');
  });

  it('handles mixed case with extra spaces', () => {
    expect(normalizeText('  FOO   BAR  ')).toBe('foo bar');
  });

  it('returns empty string for null', () => {
    expect(normalizeText(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeText(undefined)).toBe('');
  });

  it('converts numbers to lowercase string', () => {
    expect(normalizeText(42)).toBe('42');
  });

  it('preserves single space between words', () => {
    expect(normalizeText('one two three')).toBe('one two three');
  });

  it('handles tab characters as whitespace', () => {
    expect(normalizeText('foo\t\tbar')).toBe('foo bar');
  });

  it('handles newline characters', () => {
    expect(normalizeText('foo\nbar')).toBe('foo bar');
  });

  it('handles already-normalized input unchanged', () => {
    expect(normalizeText('hello world')).toBe('hello world');
  });
});
