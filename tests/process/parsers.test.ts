import { describe, expect, it } from 'vitest';
import {
  getParser,
  parseAngularLine,
  parseWebpackLine,
  reduceBuild,
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

  it('captures an "ERROR in" line as the failure reason', () => {
    expect(parseWebpackLine('ERROR in ./src/app.ts 12:4 - Type error')).toEqual({
      type: 'build:failed',
      reason: 'ERROR in ./src/app.ts 12:4 - Type error',
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

  it('treats the watch-mode "Rebuilding..." spinner lines as build:start', () => {
    // On a file-change rebuild the dev-server prints "Changes detected.
    // Rebuilding..." — the "Re" prefix means a bare \bBuilding\b never matches,
    // so without explicit handling a successful edit emits no build:start and
    // the row never flashes "building" again.
    expect(parseAngularLine('❯ Changes detected. Rebuilding...')?.type).toBe('build:start');
    expect(parseAngularLine('✔ Changes detected. Rebuilding...')?.type).toBe('build:start');
  });

  it('detects esbuild bundle-complete with a seconds duration', () => {
    expect(
      parseAngularLine('Application bundle generation complete. [1.197 seconds]'),
    ).toMatchObject({ type: 'build:complete', durationMs: 1197 });
  });

  it('detects esbuild bundle-generation failure', () => {
    expect(parseAngularLine('Application bundle generation failed. [0.523 seconds]')?.type).toBe(
      'build:failed',
    );
    expect(parseAngularLine('✘ [ERROR] Unexpected token')?.type).toBe('build:failed');
  });

  it('captures the esbuild diagnostic line as the failure reason', () => {
    expect(parseAngularLine('✘ [ERROR] TS2322: Type mismatch [plugin angular-compiler]')).toEqual({
      type: 'build:failed',
      reason: '✘ [ERROR] TS2322: Type mismatch [plugin angular-compiler]',
    });
  });

  it('detects tsc-style diagnostics the dev-server forwards (mixed/lowercase)', () => {
    // The Angular/TS compiler prints "Error: src/foo.ts:1:1 - error TS2300: ..."
    // (lowercase "error TS"), which a bare uppercase \bERROR\b would miss — so
    // the build would silently appear to never fail.
    const line =
      "Error: apps/widget/src/app/app.component.ts:25:7 - error TS2300: Duplicate identifier '(Missing)'.";
    expect(parseAngularLine(line)).toEqual({ type: 'build:failed', reason: line });
  });

  it('ignores code-frame continuation lines (no diagnostic code)', () => {
    expect(parseAngularLine('  apps/widget/src/app/app.component.ts:25:49')).toBeNull();
    expect(
      parseAngularLine('    25   this.localizationService.currentLanguage$.pipe(...)'),
    ).toBeNull();
  });

  it('does not attach a reason to the bundle-generation-failed summary line', () => {
    // The summary only flips the phase; the detail lives in the diagnostics.
    expect(parseAngularLine('Application bundle generation failed. [0.523 seconds]')).toEqual({
      type: 'build:failed',
    });
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

describe('reduceBuild', () => {
  it('maps build:start to building', () => {
    expect(reduceBuild({ type: 'build:start' })).toEqual({ phase: 'building' });
  });

  it('carries progress percent', () => {
    expect(reduceBuild({ type: 'build:progress', percent: 42 })).toEqual({
      phase: 'building',
      percent: 42,
    });
  });

  it('surfaces a failed compile from build:complete', () => {
    expect(
      reduceBuild({ type: 'build:complete', success: false, errors: 21, warnings: 0 }),
    ).toEqual({ phase: 'done', success: false, errors: 21, warnings: 0, durationMs: undefined });
  });

  it('keeps duration on a successful build', () => {
    expect(
      reduceBuild({
        type: 'build:complete',
        success: true,
        errors: 0,
        warnings: 2,
        durationMs: 1840,
      }),
    ).toEqual({ phase: 'done', success: true, errors: 0, warnings: 2, durationMs: 1840 });
  });

  it('maps build:failed', () => {
    expect(reduceBuild({ type: 'build:failed', reason: 'Failed to compile' })).toEqual({
      phase: 'failed',
      reason: 'Failed to compile',
    });
  });
});
