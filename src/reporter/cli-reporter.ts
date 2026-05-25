import chalk from 'chalk';
import type { BootSummary, Orckit } from '../orchestrator/orchestrator.js';
import { formatDuration } from '../config/duration.js';
import type { ProcessState } from '../orchestrator/lifecycle.js';

const STATE_COLOR: Record<ProcessState, (s: string) => string> = {
  pending: chalk.gray,
  starting: chalk.yellow,
  ready: chalk.green,
  running: chalk.green,
  finished: chalk.green,
  stopping: chalk.yellow,
  stopped: chalk.gray,
  failed: chalk.red,
};

const STATE_ICON: Record<ProcessState, string> = {
  pending: '·',
  starting: '⠋',
  ready: '✓',
  running: '●',
  finished: '✓',
  stopping: '⠿',
  stopped: '○',
  failed: '✗',
};

export interface CliReporterOptions {
  showOutput?: boolean;
  showBuild?: boolean;
  /**
   * How many of the most recent output lines to dump beneath a `process:failed`
   * line. 0 disables the dump entirely. Defaults to 10.
   */
  failureTailLines?: number;
  /**
   * Optional hint sink for messages that should appear above the REPL prompt.
   * If omitted, hints are written to stdout with a leading blank line.
   */
  printHint?: (message: string) => void;
  /**
   * Where to send output. Defaults to `console.log`. The live boot view passes
   * its `printAbove` so reporter output flows above the live graph cleanly.
   */
  out?: (msg: string) => void;
  /**
   * Suppress per-process lifecycle event lines (starting / ready / finished /
   * stopped / failed / restarting). Set this when another consumer — the live
   * boot view — owns the rendering of those state changes. Failure tails
   * (the recent-output dump) are still printed.
   */
  quietProcessEvents?: boolean;
}

export function attachCliReporter(orckit: Orckit, opts: CliReporterOptions = {}): () => void {
  const out = opts.out ?? ((msg: string) => console.log(msg));
  const hint = opts.printHint ?? ((msg: string) => out('\n' + msg));
  const tailLines = opts.failureTailLines ?? 10;
  const quiet = opts.quietProcessEvents ?? false;

  const onStarting = (name: string) => {
    if (quiet) return;
    out(chalk.gray(`  ${STATE_ICON.starting} ${name} starting`));
  };
  const onReady = (name: string, ms: number) => {
    if (quiet) return;
    out(`  ${chalk.green(STATE_ICON.ready)} ${name} ready ${chalk.dim(`(${formatDuration(ms)})`)}`);
  };
  const onFinished = (name: string, ms: number) => {
    if (quiet) return;
    out(
      `  ${chalk.green(STATE_ICON.finished)} ${name} finished ${chalk.dim(`(${formatDuration(ms)})`)}`,
    );
  };
  const onStopped = (name: string) => {
    if (quiet) return;
    out(`  ${chalk.gray(STATE_ICON.stopped)} ${name} stopped`);
  };
  const onFailed = (name: string, err?: Error) => {
    if (!quiet) {
      out(
        `  ${chalk.red(STATE_ICON.failed)} ${name} failed${err ? `: ${chalk.red(err.message)}` : ''}`,
      );
    }
    if (tailLines > 0) {
      const tail = orckit.output(name, tailLines);
      if (quiet && tail.length > 0) {
        // The live view consumes the "failed" headline itself, but the user
        // still wants to see WHY — print a short prefix so the dump is
        // recognisable in scrollback.
        out(`  ${chalk.red(STATE_ICON.failed)} ${name} failed${err ? `: ${chalk.red(err.message)}` : ''}`);
      }
      for (const line of tail) {
        const marker = line.stream === 'stderr' ? chalk.red('!') : chalk.red('│');
        out(`      ${marker} ${chalk.dim(line.text)}`);
      }
    }
  };
  const onRestarting = (name: string, attempt: number) => {
    if (quiet) return;
    out(`  ${chalk.yellow('↻')} ${name} restarting (attempt ${attempt})`);
  };
  const onPreflightStart = () => out(chalk.cyan.bold('\n  Preflight'));
  const onPreflightResult = (r: {
    name: string;
    passed: boolean;
    stderr?: string;
    onFail?: string;
  }) => {
    const icon = r.passed ? chalk.green('✓') : chalk.red('✗');
    out(`    ${icon} ${r.name}`);
    if (!r.passed) {
      if (r.stderr) out(chalk.red(`      ${r.stderr.trim().split('\n').join('\n      ')}`));
      if (r.onFail) out(chalk.dim(`      hint: ${r.onFail}`));
    }
  };
  const onAllReady = (names: string[]) =>
    out(chalk.green.bold(`\n  ✓ ${names.length} process(es) ready\n`));
  const onBootComplete = (summary: BootSummary) => {
    if (summary.failed.length === 0 && summary.pending.length === 0) return;
    const parts: string[] = [];
    if (summary.failed.length > 0) {
      parts.push(chalk.red(`${summary.failed.length} failed`) + ` (${summary.failed.join(', ')})`);
    }
    if (summary.pending.length > 0) {
      parts.push(
        chalk.yellow(`${summary.pending.length} pending`) + ` (${summary.pending.join(', ')})`,
      );
    }
    if (summary.ready.length > 0) {
      parts.unshift(chalk.green(`${summary.ready.length} ready`));
    }
    // When the boot is about to die because something failed without
    // manual_retry, don't suggest a retry — the CLI will print its own
    // diagnostic and exit.
    if (summary.strictFailures.length > 0) {
      hint(`  ${parts.join('  ')}`);
      return;
    }
    const retryable = summary.failed.join(' ');
    const retryHint = retryable
      ? `type ${chalk.cyan(`r ${retryable}`)} to retry, ${chalk.cyan('?')} for help`
      : `type ${chalk.cyan('?')} for help`;
    hint(`  ${parts.join('  ')}\n  ${retryHint}`);
  };
  const onLine = opts.showOutput
    ? (name: string, line: { text: string; stream: string; highlight?: string }) => {
        const colorFn = line.highlight ? colorFor(line.highlight) : chalk.dim;
        const stream = line.stream === 'stderr' ? chalk.red('!') : chalk.dim('│');
        out(`  ${chalk.cyan(name)} ${stream} ${colorFn(line.text)}`);
      }
    : null;
  const onBuild = opts.showBuild
    ? (name: string, event: { type: string }) => out(chalk.magenta(`  ◆ ${name} ${event.type}`))
    : null;

  orckit.on('preflight:start', onPreflightStart);
  orckit.on('preflight:result', onPreflightResult);
  orckit.on('process:starting', onStarting);
  orckit.on('process:ready', onReady);
  orckit.on('process:finished', onFinished);
  orckit.on('process:stopped', onStopped);
  orckit.on('process:failed', onFailed);
  orckit.on('process:restarting', onRestarting);
  orckit.on('all:ready', onAllReady);
  orckit.on('boot:complete', onBootComplete);
  if (onLine) orckit.on('process:line', onLine);
  if (onBuild) orckit.on('process:build', onBuild);

  return () => {
    orckit.off('preflight:start', onPreflightStart);
    orckit.off('preflight:result', onPreflightResult);
    orckit.off('process:starting', onStarting);
    orckit.off('process:ready', onReady);
    orckit.off('process:finished', onFinished);
    orckit.off('process:stopped', onStopped);
    orckit.off('process:failed', onFailed);
    orckit.off('process:restarting', onRestarting);
    orckit.off('all:ready', onAllReady);
    orckit.off('boot:complete', onBootComplete);
    if (onLine) orckit.off('process:line', onLine);
    if (onBuild) orckit.off('process:build', onBuild);
  };
}

export function renderStatus(states: Map<string, ProcessState>): string {
  const lines: string[] = [];
  const max = Math.max(...[...states.keys()].map((n) => n.length), 4);
  for (const [name, state] of states) {
    const color = STATE_COLOR[state];
    lines.push(`  ${color(STATE_ICON[state])} ${name.padEnd(max)}  ${color(state)}`);
  }
  return lines.join('\n');
}

function colorFor(color: string): (s: string) => string {
  switch (color) {
    case 'red':
      return chalk.red;
    case 'green':
      return chalk.green;
    case 'yellow':
      return chalk.yellow;
    case 'blue':
      return chalk.blue;
    case 'magenta':
      return chalk.magenta;
    case 'cyan':
      return chalk.cyan;
    case 'gray':
      return chalk.gray;
    default:
      return (s) => s;
  }
}
