import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';
import { hyperlink } from '../../src/reporter/hyperlink.js';

describe('hyperlink', () => {
  const level = chalk.level;
  afterEach(() => {
    chalk.level = level;
  });

  it('wraps the text in an OSC 8 link when escapes are supported', () => {
    chalk.level = 1;
    expect(hyperlink('http://localhost:4200', 'web')).toBe(
      '\x1b]8;;http://localhost:4200\x1b\\web\x1b]8;;\x1b\\',
    );
  });

  it('defaults the text to the URL', () => {
    chalk.level = 1;
    expect(hyperlink('http://localhost:4200')).toContain('\x1b\\http://localhost:4200\x1b]8;;');
  });

  it('returns plain text when chalk has no color support', () => {
    chalk.level = 0;
    expect(hyperlink('http://localhost:4200', 'web')).toBe('web');
  });
});
