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

/**
 * A reduced, serializable snapshot of where a process's most recent build
 * stands. Unlike `BuildEvent` (a momentary signal), this is the *current*
 * state — what a reporter pins next to the process. Each event fully
 * determines the next state, so the reducer ignores the prior one.
 */
export type BuildStatus =
  | { phase: 'building'; percent?: number }
  | { phase: 'done'; success: boolean; errors: number; warnings: number; durationMs?: number }
  | { phase: 'failed'; reason?: string };

export function reduceBuild(event: BuildEvent): BuildStatus {
  switch (event.type) {
    case 'build:start':
      return { phase: 'building' };
    case 'build:progress':
      return { phase: 'building', percent: event.percent };
    case 'build:complete':
      return {
        phase: 'done',
        success: event.success,
        errors: event.errors,
        warnings: event.warnings,
        durationMs: event.durationMs,
      };
    case 'build:failed':
      return { phase: 'failed', reason: event.reason };
  }
}

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
  if (WEBPACK_ERROR.test(line)) return { type: 'build:failed', reason: line.trim() };

  return null;
};

// Matches both the old webpack-based output ("Compiling...", "Generating browser
// application bundles") and the current esbuild dev-server, which prints a
// spinner line like "❯ Building..." / "✔ Building..." (hence \bBuilding\b rather
// than an anchored ^Building — the line is prefixed by a glyph). On a watch-mode
// rebuild that same server prints "❯ Changes detected. Rebuilding..." — note the
// "Re" prefix means a bare \bBuilding\b never matches it, so list "Rebuilding"
// explicitly or a file change after the first build emits no build:start and the
// row never flashes "building" again.
const ANGULAR_BUILDING =
  /(?:Compiling|\b(?:Re)?[Bb]uilding\b|Changes detected|Generating browser application bundles|Application bundle generation\b(?!.*(?:complete|failed)))/;
// NOTE: do not match a bare "✔" here — esbuild emits "✔ Building..." mid-build,
// which is NOT a completion. The real signal is the explicit phrase below (the
// "✔ Application bundle generation complete" case still matches on the phrase).
const ANGULAR_COMPLETE =
  /(?:Compiled successfully|Application bundle generation complete|Build at:.*Time:\s*\d+\s*ms)/;
// Old webpack output reports "Time: 1234 ms"; the esbuild dev-server reports
// "Application bundle generation complete. [0.126 seconds]". Capture either.
const ANGULAR_TIME = /Time:\s*(\d+)\s*ms/;
const ANGULAR_TIME_SECONDS = /\[(\d+(?:\.\d+)?)\s*seconds?\]/;
// Two flavours of failure. The *summary* line ("Application bundle generation
// failed") only tells us the phase flipped — it carries no detail worth
// surfacing. The *diagnostic* lines are the actual errors and ARE worth
// capturing as the build:failed `reason` so a reporter can list them in an
// error panel. Critically, the diagnostic set must be case-tolerant: the
// esbuild dev-server prints "✘ [ERROR] ..." but the Angular/TS compiler prints
// "Error: src/foo.ts:1:1 - error TS2322: ..." (mixed/lowercase), so a bare
// uppercase \bERROR\b misses every tsc diagnostic and the build silently
// appears to never fail.
const ANGULAR_FAIL_SUMMARY =
  /(?:Failed to compile|Build failed|Application bundle generation failed)/;
const ANGULAR_DIAGNOSTIC = /(?:[✖✘]|\bERROR\b|\berror TS\d+\b)/;
const ANGULAR_PROGRESS = /(\d{1,3})%/;

export const parseAngularLine: LineParser = (rawLine) => {
  const line = stripAnsi(rawLine);
  if (ANGULAR_FAIL_SUMMARY.test(line)) return { type: 'build:failed' };
  if (ANGULAR_DIAGNOSTIC.test(line)) return { type: 'build:failed', reason: line.trim() };
  if (ANGULAR_COMPLETE.test(line)) {
    const msMatch = line.match(ANGULAR_TIME);
    const secMatch = line.match(ANGULAR_TIME_SECONDS);
    const durationMs = msMatch
      ? Number(msMatch[1])
      : secMatch
        ? Math.round(Number(secMatch[1]) * 1000)
        : undefined;
    return {
      type: 'build:complete',
      success: true,
      errors: 0,
      warnings: 0,
      durationMs,
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
