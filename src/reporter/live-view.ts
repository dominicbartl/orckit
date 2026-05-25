import chalk from 'chalk';
import type { Orckit } from '../orchestrator/orchestrator.js';
import type { ProcessState } from '../orchestrator/lifecycle.js';
import { buildGraph, type DependencyGraph } from '../graph/resolver.js';
import { renderGraph } from './graph-view.js';
import { formatDuration } from '../config/duration.js';

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const UP_AND_CLEAR = '\x1b[F\x1b[2K';

export interface LiveBootViewOptions {
  /**
   * Spinner animation tick in milliseconds. Set to 0 to disable animation
   * (the graph still re-renders on state changes). Default: 80ms.
   */
  tickMs?: number;
  /**
   * Stream to write to. Defaults to `process.stdout`. Tests inject a fake.
   */
  stream?: NodeJS.WriteStream;
  /**
   * Bypass the TTY check. Without this, `attachLiveBootView` returns `null`
   * when the stream is not a TTY so the caller can fall back to plain
   * line-by-line reporting.
   */
  force?: boolean;
}

export interface LiveBootViewHandle {
  /**
   * Print a line above the live graph. The live region is cleared, the
   * content is written, and the graph is redrawn underneath. After `dispose()`
   * this falls through to a plain write.
   */
  printAbove: (msg: string) => void;
  /**
   * Stop animating, flush a final frame, restore the cursor. The current
   * graph state stays in scrollback so the user can see how the boot ended.
   */
  dispose: () => void;
}

/**
 * Attach a live boot view: the dependency graph renders at the bottom of the
 * terminal and updates in place as states change. Returns `null` when stdout
 * isn't a TTY (the caller should attach the regular cli-reporter instead).
 *
 * Wire this in by passing `live.printAbove` as the cli-reporter's `out` and
 * setting `quietProcessEvents: true` so the reporter doesn't duplicate the
 * state info the graph already shows.
 */
export function attachLiveBootView(
  orckit: Orckit,
  opts: LiveBootViewOptions = {},
): LiveBootViewHandle | null {
  const stream = opts.stream ?? process.stdout;
  if (!opts.force && !stream.isTTY) return null;

  const tickMs = opts.tickMs ?? 80;
  const graph: DependencyGraph = buildGraph(orckit.config);

  const states = new Map<string, ProcessState>(orckit.states());
  const annotations = new Map<string, string>();
  const startedAt = new Map<string, number>();

  let frame = 0;
  let disposed = false;
  let lastLineCount = 0;

  const clear = () => {
    if (lastLineCount === 0) return;
    for (let i = 0; i < lastLineCount; i++) stream.write(UP_AND_CLEAR);
    lastLineCount = 0;
  };

  const draw = () => {
    const content = renderGraph(graph, { states, spinnerFrame: frame, annotations });
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
    redraw();
  };

  orckit.on('process:state', onState);
  orckit.on('process:starting', onStarting);
  orckit.on('process:ready', onReady);
  orckit.on('process:finished', onFinished);
  orckit.on('process:failed', onFailed);
  orckit.on('process:restarting', onRestarting);

  // Initial paint.
  if (stream.isTTY) stream.write(HIDE_CURSOR);
  draw();

  const timer =
    tickMs > 0
      ? setInterval(() => {
          frame = (frame + 1) | 0;
          // Only redraw when at least one process is animating — otherwise
          // we're wasting writes on a static view.
          for (const s of states.values()) {
            if (s === 'starting') {
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
      // One final frame so the rendered state matches the latest events even
      // if a tick was mid-flight.
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
    },
  };
}
