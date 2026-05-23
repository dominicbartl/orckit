import chalk from 'chalk';
import type { Orckit } from '../orchestrator/orchestrator.js';
import { formatDuration } from '../config/duration.js';
import type { ProcessState } from '../orchestrator/lifecycle.js';

const STATE_COLOR: Record<ProcessState, (s: string) => string> = {
  pending: chalk.gray,
  starting: chalk.yellow,
  ready: chalk.green,
  running: chalk.green,
  stopping: chalk.yellow,
  stopped: chalk.gray,
  failed: chalk.red,
};

const STATE_ICON: Record<ProcessState, string> = {
  pending: '·',
  starting: '⠋',
  ready: '✓',
  running: '●',
  stopping: '⠿',
  stopped: '○',
  failed: '✗',
};

export interface CliReporterOptions {
  showOutput?: boolean;
  showBuild?: boolean;
}

export function attachCliReporter(orckit: Orckit, opts: CliReporterOptions = {}): () => void {
  const out = (msg: string) => console.log(msg);

  const onStarting = (name: string) => out(chalk.gray(`  ${STATE_ICON.starting} ${name} starting`));
  const onReady = (name: string, ms: number) =>
    out(`  ${chalk.green(STATE_ICON.ready)} ${name} ready ${chalk.dim(`(${formatDuration(ms)})`)}`);
  const onStopped = (name: string) => out(`  ${chalk.gray(STATE_ICON.stopped)} ${name} stopped`);
  const onFailed = (name: string, err?: Error) =>
    out(
      `  ${chalk.red(STATE_ICON.failed)} ${name} failed${err ? `: ${chalk.red(err.message)}` : ''}`,
    );
  const onRestarting = (name: string, attempt: number) =>
    out(`  ${chalk.yellow('↻')} ${name} restarting (attempt ${attempt})`);
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
  const onLine = opts.showOutput
    ? (name: string, line: { text: string; stream: string; highlight?: string }) => {
        const colorFn = line.highlight ? colorFor(line.highlight) : chalk.dim;
        const stream = line.stream === 'stderr' ? chalk.red('!') : chalk.dim('│');
        console.log(`  ${chalk.cyan(name)} ${stream} ${colorFn(line.text)}`);
      }
    : null;
  const onBuild = opts.showBuild
    ? (name: string, event: { type: string }) => out(chalk.magenta(`  ◆ ${name} ${event.type}`))
    : null;

  orckit.on('preflight:start', onPreflightStart);
  orckit.on('preflight:result', onPreflightResult);
  orckit.on('process:starting', onStarting);
  orckit.on('process:ready', onReady);
  orckit.on('process:stopped', onStopped);
  orckit.on('process:failed', onFailed);
  orckit.on('process:restarting', onRestarting);
  orckit.on('all:ready', onAllReady);
  if (onLine) orckit.on('process:line', onLine);
  if (onBuild) orckit.on('process:build', onBuild);

  return () => {
    orckit.off('preflight:start', onPreflightStart);
    orckit.off('preflight:result', onPreflightResult);
    orckit.off('process:starting', onStarting);
    orckit.off('process:ready', onReady);
    orckit.off('process:stopped', onStopped);
    orckit.off('process:failed', onFailed);
    orckit.off('process:restarting', onRestarting);
    orckit.off('all:ready', onAllReady);
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
