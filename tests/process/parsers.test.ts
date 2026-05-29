import { describe, expect, it } from 'vitest';
import {
  getParser,
  parseAngularLine,
  parseWebpackLine,
  stripAnsi,
} from '../../src/process/parsers.js';

describe('stripAnsi', () => {
  it('removes color codes', () => {
    expect(stripAnsi('\x1B[32m✔\x1B[39m done')).toBe('✔ done');
  });

  it('leaves plain text alone', () => {
    expect(stripAnsi('hello')).toBe('hello');
  });
});

describe('parseWebpackLine', () => {
  it('detects build start', () => {
    expect(parseWebpackLine('webpack 5.x compiling...')).toEqual({ type: 'build:start' });
  });

  it('detects progress percentage', () => {
    expect(parseWebpackLine('[42%] modules')).toEqual({ type: 'build:progress', percent: 42 });
  });

  it('detects successful compile', () => {
    expect(parseWebpackLine('webpack compiled successfully')).toEqual({
      type: 'build:complete',
      success: true,
      errors: 0,
      warnings: 0,
    });
  });

  it('detects compile with errors', () => {
    expect(parseWebpackLine('webpack compiled with 3 errors and 1 warning')).toEqual({
      type: 'build:complete',
      success: false,
      errors: 3,
      warnings: 1,
    });
  });

  it('detects failure', () => {
    expect(parseWebpackLine('Failed to compile.')).toEqual({
      type: 'build:failed',
      reason: 'Failed to compile',
    });
  });

  it('ignores unrelated lines', () => {
    expect(parseWebpackLine('some random output')).toBeNull();
  });

  it('strips ANSI before matching', () => {
    expect(parseWebpackLine('\x1B[32mwebpack compiled successfully\x1B[39m')?.type).toBe(
      'build:complete',
    );
  });
});

describe('parseAngularLine', () => {
  it('detects building', () => {
    expect(parseAngularLine('Building...')?.type).toBe('build:start');
  });

  it('detects modern Angular bundle-complete with ANSI', () => {
    expect(
      parseAngularLine('\x1B[32m✔\x1B[39m Application bundle generation complete')?.type,
    ).toBe('build:complete');
  });

  it('treats the esbuild "Building..." spinner lines as build:start, not complete', () => {
    // The esbuild dev-server prints a glyph-prefixed spinner; the ✔ variant is
    // mid-build (the checkmark is just the spinner resolving), NOT a completion.
    expect(parseAngularLine('❯ Building...')?.type).toBe('build:start');
    expect(parseAngularLine('✔ Building...')?.type).toBe('build:start');
  });

  it('detects esbuild bundle-complete with a seconds duration', () => {
    expect(
      parseAngularLine('Application bundle generation complete. [1.197 seconds]')?.type,
    ).toBe('build:complete');
  });

  it('detects esbuild bundle-generation failure', () => {
    expect(parseAngularLine('Application bundle generation failed. [0.523 seconds]')?.type).toBe(
      'build:failed',
    );
    expect(parseAngularLine('✘ [ERROR] Unexpected token')?.type).toBe('build:failed');
  });

  it('extracts build time when present', () => {
    const event = parseAngularLine('Build at: 2024-01-01 Time: 4250ms');
    expect(event).toMatchObject({ type: 'build:complete', durationMs: 4250 });
  });

  it('detects failures', () => {
    expect(parseAngularLine('Build failed.')?.type).toBe('build:failed');
  });
});

describe('getParser', () => {
  it('returns parsers for known types', () => {
    expect(getParser('webpack')).toBe(parseWebpackLine);
    expect(getParser('angular')).toBe(parseAngularLine);
  });

  it('returns null for bash', () => {
    expect(getParser('bash')).toBeNull();
  });
});
