import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration } from '../../src/config/duration.js';

describe('parseDuration', () => {
  it.each([
    ['500ms', 500],
    ['5s', 5000],
    ['1.5s', 1500],
    ['10m', 600_000],
    ['1h', 3_600_000],
    ['0ms', 0],
  ])('parses %s as %d ms', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it('rejects bare numbers', () => {
    expect(() => parseDuration('500')).toThrow(/invalid duration/);
  });

  it('rejects unknown units', () => {
    expect(() => parseDuration('5d')).toThrow(/invalid duration/);
  });

  it('rejects negative numbers', () => {
    expect(() => parseDuration('-5s')).toThrow(/invalid duration/);
  });

  it('trims whitespace', () => {
    expect(parseDuration('  3s  ')).toBe(3000);
  });
});

describe('formatDuration', () => {
  it.each([
    [500, '500ms'],
    [1500, '1.5s'],
    [60_000, '1.0m'],
    [3_600_000, '1.0h'],
  ])('formats %d as %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});
