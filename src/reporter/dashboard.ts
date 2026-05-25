import chalk from 'chalk';
import type { Orckit } from '../orchestrator/orchestrator.js';
import type { ProcessState } from '../orchestrator/lifecycle.js';
import { buildGraph, type DependencyGraph } from '../graph/resolver.js';
import { renderGraph } from './graph-view.js';
import { formatDuration } from '../config/duration.js';
import { brandHeader } from './brand.js';
import type { BuildEvent } from '../process/parsers.js';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const UP_AND_CLEAR = '\x1b[F\x1b[2K';

const ACCENT = '#4fb8c8';
const ACCENT_DIM = '#2f8a98';

/** A labelled URL or path to render in the dashboard header. */
export interface DashboardLink {
  /** Short tag (e.g. `web`, `mcp`, `logs`). */
  label: string;
  /** The URL or path. */
  value: string;
}

export interface DashboardOptions {
  /** Spinner animation tick (ms). 0 disables animation. Default: 80ms. */
  tickMs?: number;
  /** Stream to write to. Defaults to process.stdout (tests inject a fake). */
  stream?: NodeJS.WriteStream;
  /** Bypass the TTY check — useful for tests. */
  force?: boolean;
  /** Links rendered in the header next to the brand mark. */
  links?: DashboardLink[];
}

export interface DashboardHandle {
  /**
   * Print a line above the live region. Used by the cli-reporter to emit
   * preflight banners, failure tails, and other one-off messages without
   * disturbing the persistent dashboard at the bottom of the terminal.
   */
  printAbove: (msg: string) => void;
  /**
   * Stop animating, flush a final frame, restore the cursor. The final
   * dashboard state stays in scrollback so the user can see how things ended.
   */
  dispose: () => void;
}

type BuildStatus =
  | { kind: 'building'; percent?: number }
  | { kind: 'done'; success: boolean; ms?: number; errors?: number; warnings?: number }
  | { kind: 'failed'; reason?: string };

/**
 * Attach the persistent orckit dashboard: a live region at the bottom of the
 * terminal showing the brand header, dependency graph (state-aware), and a
 * compact counter footer. Stays attached for the whole `orc start` session.
 *
 * Returns `null` when stdout isn't a TTY — the caller should fall back to the
 * plain line-by-line reporter (and optionally the REPL) instead.
 */
export function attachDashboard(
  orckit: Orckit,
  opts: DashboardOptions = {},
): DashboardHandle | null {
  const stream = opts.stream ?? process.stdout;
  if (!opts.force && !stream.isTTY) return null;

  const tickMs = opts.tickMs ?? 80;
  const graph: DependencyGraph = buildGraph(orckit.config);
  const project = orckit.config.project;
  const links = opts.links ?? [];

  const states = new Map<string, ProcessState>(orckit.states());
  const annotations = new Map<string, string>();
  const builds = new Map<string, BuildStatus>();
  const startedAt = new Map<string, number>();

  let frame = 0;
  let disposed = false;
  let lastLineCount = 0;

  const composeAnnotation = (name: string): string => {
    const parts: string[] = [];
    const ann = annotations.get(name);
    if (ann) parts.push(ann);
    const build = builds.get(name);
    if (build) parts.push(renderBuild(build));
    return parts.join('  ');
  };

  const clear = () => {
    if (lastLineCount === 0) return;
    for (let i = 0; i < lastLineCount; i++) stream.write(UP_AND_CLEAR);
    lastLineCount = 0;
  };

  const render = (): string => {
    const headerLabels = composeHeaderLabels(project, links);
    const header = brandHeader(headerLabels);

    const composed = new Map<string, string>();
    for (const name of states.keys()) {
      const ann = composeAnnotation(name);
      if (ann) composed.set(name, ann);
    }

    const body = renderGraph(graph, {
      states,
      spinnerFrame: frame,
      annotations: composed,
    })
      .split('\n')
      .map((line) => '  ' + line)
      .join('\n');
    const footer = renderFooter(states, builds);

    return [header, '', body, '', footer].join('\n');
  };

  const draw = () => {
    const content = render();
    const lines = content.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const text = lines.map((l) => l + '\n').join('');
    stream.write(text);
    lastLineCount = lines.length;
  };

  const redraw = () => {
    if (disposed) return;
    clear();
    draw();
  };

  const printAbove = (msg: string) => {
    const text = msg.endsWith('\n') ? msg : msg + '\n';
    if (disposed) {
      stream.write(text);
      return;
    }
    clear();
    stream.write(text);
    draw();
  };

  // --- event handlers ---
  const onState = (name: string, state: ProcessState) => {
    states.set(name, state);
    // Drop stale build state when a process is restarted or stopped.
    if (state === 'pending' || state === 'starting' || state === 'stopped') {
      builds.delete(name);
    }
    redraw();
  };
  const onStarting = (name: string) => {
    startedAt.set(name, Date.now());
    // process:state fires alongside; no need to redraw here.
  };
  const onReady = (name: string, ms: number) => {
    annotations.set(name, chalk.dim(`(${formatDuration(ms)})`));
    redraw();
  };
  const onFinished = (name: string, ms: number) => {
    annotations.set(name, chalk.dim(`(${formatDuration(ms)})`));
    redraw();
  };
  const onFailed = (name: string) => {
    const started = startedAt.get(name);
    const elapsed = started != null ? Date.now() - started : null;
    annotations.set(
      name,
      chalk.red(elapsed != null ? `(failed after ${formatDuration(elapsed)})` : '(failed)'),
    );
    redraw();
  };
  const onRestarting = (name: string, attempt: number) => {
    annotations.set(name, chalk.yellow(`(retry ${attempt})`));
    startedAt.set(name, Date.now());
    builds.delete(name);
    redraw();
  };
  const onBuild = (name: string, event: BuildEvent) => {
    switch (event.type) {
      case 'build:start':
        builds.set(name, { kind: 'building' });
        break;
      case 'build:progress':
        builds.set(name, { kind: 'building', percent: event.percent });
        break;
      case 'build:complete':
        builds.set(name, {
          kind: 'done',
          success: event.success,
          ms: event.durationMs,
          errors: event.errors,
          warnings: event.warnings,
        });
        break;
      case 'build:failed':
        builds.set(name, { kind: 'failed', reason: event.reason });
        break;
    }
    redraw();
  };

  orckit.on('process:state', onState);
  orckit.on('process:starting', onStarting);
  orckit.on('process:ready', onReady);
  orckit.on('process:finished', onFinished);
  orckit.on('process:failed', onFailed);
  orckit.on('process:restarting', onRestarting);
  orckit.on('process:build', onBuild);

  // Initial paint.
  if (stream.isTTY) stream.write(HIDE_CURSOR);
  draw();

  const timer =
    tickMs > 0
      ? setInterval(() => {
          frame = (frame + 1) | 0;
          for (const s of states.values()) {
            if (s === 'starting' || s === 'stopping') {
              redraw();
              return;
            }
          }
          for (const b of builds.values()) {
            if (b.kind === 'building') {
              redraw();
              return;
            }
          }
        }, tickMs)
      : null;

  return {
    printAbove,
    dispose: () => {
      if (disposed) return;
      if (timer) clearInterval(timer);
      clear();
      draw();
      disposed = true;
      if (stream.isTTY) stream.write(SHOW_CURSOR);
      orckit.off('process:state', onState);
      orckit.off('process:starting', onStarting);
      orckit.off('process:ready', onReady);
      orckit.off('process:finished', onFinished);
      orckit.off('process:failed', onFailed);
      orckit.off('process:restarting', onRestarting);
      orckit.off('process:build', onBuild);
    },
  };
}

function composeHeaderLabels(project: string | undefined, links: DashboardLink[]): string[] {
  const labels: string[] = [];
  labels.push(chalk.hex(ACCENT).bold('orckit'));
  labels.push(project ? chalk.dim(project) : chalk.dim('(no project)'));
  for (const link of links) {
    labels.push(`${chalk.hex(ACCENT_DIM)(link.label.padEnd(4))}  ${chalk.dim(link.value)}`);
  }
  return labels;
}

function renderBuild(build: BuildStatus): string {
  switch (build.kind) {
    case 'building': {
      const pct = build.percent != null ? ` ${build.percent}%` : '';
      return chalk.hex(ACCENT)(`building${pct}`);
    }
    case 'done': {
      if (build.success) {
        const ms = build.ms != null ? ` ${formatDuration(build.ms)}` : '';
        const warn =
          build.warnings && build.warnings > 0 ? chalk.yellow(` ⚠ ${build.warnings}`) : '';
        return chalk.green(`built${ms}`) + warn;
      }
      const errs = build.errors ? ` (${build.errors} errors)` : '';
      return chalk.red(`build failed${errs}`);
    }
    case 'failed':
      return chalk.red(build.reason ? `build failed — ${build.reason}` : 'build failed');
  }
}

function renderFooter(
  states: ReadonlyMap<string, ProcessState>,
  builds: ReadonlyMap<string, BuildStatus>,
): string {
  let ready = 0;
  let starting = 0;
  let failed = 0;
  let pending = 0;
  let stopped = 0;
  for (const s of states.values()) {
    if (s === 'ready' || s === 'running' || s === 'finished') ready++;
    else if (s === 'starting') starting++;
    else if (s === 'failed') failed++;
    else if (s === 'pending') pending++;
    else if (s === 'stopped' || s === 'stopping') stopped++;
  }
  let building = 0;
  for (const b of builds.values()) if (b.kind === 'building') building++;
  const total = states.size;

  const parts: string[] = [];
  parts.push(`${chalk.green(`${ready}/${total}`)} ${chalk.dim('ready')}`);
  if (building > 0) parts.push(`${chalk.hex(ACCENT)(building)} ${chalk.dim('building')}`);
  if (starting > 0) parts.push(`${chalk.yellow(starting)} ${chalk.dim('starting')}`);
  if (failed > 0) parts.push(`${chalk.red(failed)} ${chalk.dim('failed')}`);
  if (pending > 0) parts.push(chalk.dim(`${pending} pending`));
  if (stopped > 0) parts.push(chalk.dim(`${stopped} stopped`));

  return '  ' + parts.join(chalk.dim('  ·  '));
}
