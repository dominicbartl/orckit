import type { ProcessType } from '../config/schema.js';

export type BuildEvent =
  | { type: 'build:start' }
  | { type: 'build:progress'; percent: number }
  | {
      type: 'build:complete';
      success: boolean;
      errors: number;
      warnings: number;
      durationMs?: number;
    }
  | { type: 'build:failed'; reason?: string };

export type LineParser = (line: string) => BuildEvent | null;

const ANSI_RE = /\x1B\[[0-9;]*[a-zA-Z]/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

const WEBPACK_COMPILING = /\bcompil(?:ing|ation starting)\b/i;
const WEBPACK_COMPILED_OK = /compiled\s+successfully/i;
const WEBPACK_COMPILED_WITH = /compiled\s+with\s+(\d+)\s+error/i;
const WEBPACK_WARN_COUNT = /(\d+)\s+warning/i;
const WEBPACK_ERROR = /\bERROR in\b/;
const WEBPACK_PROGRESS = /^\s*\[?(\d{1,3})%/;
const WEBPACK_FAIL = /Failed to compile/i;

export const parseWebpackLine: LineParser = (rawLine) => {
  const line = stripAnsi(rawLine);
  if (WEBPACK_FAIL.test(line)) return { type: 'build:failed', reason: 'Failed to compile' };
  if (WEBPACK_COMPILING.test(line)) return { type: 'build:start' };

  const progress = line.match(WEBPACK_PROGRESS);
  if (progress) {
    const percent = Math.min(100, Math.max(0, Number(progress[1])));
    return { type: 'build:progress', percent };
  }

  if (WEBPACK_COMPILED_OK.test(line)) {
    return { type: 'build:complete', success: true, errors: 0, warnings: 0 };
  }
  const errMatch = line.match(WEBPACK_COMPILED_WITH);
  if (errMatch) {
    const warnMatch = line.match(WEBPACK_WARN_COUNT);
    return {
      type: 'build:complete',
      success: false,
      errors: Number(errMatch[1]),
      warnings: warnMatch ? Number(warnMatch[1]) : 0,
    };
  }
  if (WEBPACK_ERROR.test(line)) return { type: 'build:failed' };

  return null;
};

// Matches both the old webpack-based output ("Compiling...", "Generating browser
// application bundles") and the current esbuild dev-server, which prints a
// spinner line like "❯ Building..." / "✔ Building..." (hence \bBuilding\b rather
// than an anchored ^Building — the line is prefixed by a glyph).
const ANGULAR_BUILDING =
  /(?:Compiling|\bBuilding\b|Generating browser application bundles|Application bundle generation\b(?!.*(?:complete|failed)))/;
// NOTE: do not match a bare "✔" here — esbuild emits "✔ Building..." mid-build,
// which is NOT a completion. The real signal is the explicit phrase below (the
// "✔ Application bundle generation complete" case still matches on the phrase).
const ANGULAR_COMPLETE =
  /(?:Compiled successfully|Application bundle generation complete|Build at:.*Time:\s*\d+\s*ms)/;
const ANGULAR_TIME = /Time:\s*(\d+)\s*ms/;
const ANGULAR_FAIL =
  /(?:Failed to compile|Build failed|Application bundle generation failed|[✖✘]|ERROR\b)/;
const ANGULAR_PROGRESS = /(\d{1,3})%/;

export const parseAngularLine: LineParser = (rawLine) => {
  const line = stripAnsi(rawLine);
  if (ANGULAR_FAIL.test(line)) return { type: 'build:failed' };
  if (ANGULAR_COMPLETE.test(line)) {
    const timeMatch = line.match(ANGULAR_TIME);
    return {
      type: 'build:complete',
      success: true,
      errors: 0,
      warnings: 0,
      durationMs: timeMatch ? Number(timeMatch[1]) : undefined,
    };
  }
  if (ANGULAR_BUILDING.test(line)) return { type: 'build:start' };

  const progress = line.match(ANGULAR_PROGRESS);
  if (progress) {
    return { type: 'build:progress', percent: Math.min(100, Number(progress[1])) };
  }

  return null;
};

export function getParser(type: ProcessType): LineParser | null {
  switch (type) {
    case 'webpack':
      return parseWebpackLine;
    case 'angular':
      return parseAngularLine;
    default:
      return null;
  }
}
