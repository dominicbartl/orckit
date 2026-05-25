import chalk from 'chalk';
import { groupIntoWaves, type DependencyGraph } from '../graph/resolver.js';
import type { ProcessState } from '../orchestrator/lifecycle.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const STATE_ICON: Record<ProcessState, string> = {
  pending: '○',
  starting: SPINNER_FRAMES[0]!, // overridden per-frame by spinnerFrame option
  ready: '✓',
  running: '●',
  finished: '✓',
  stopping: '⠿',
  stopped: '○',
  failed: '✗',
};

const STATE_COLOR: Record<ProcessState, (s: string) => string> = {
  pending: chalk.dim,
  starting: chalk.yellow,
  ready: chalk.green,
  running: chalk.green,
  finished: chalk.green,
  stopping: chalk.yellow,
  stopped: chalk.gray,
  failed: chalk.red,
};

export interface RenderGraphOptions {
  /**
   * Live process states. If omitted, every process is rendered as `pending`.
   * Pass `orckit.states()` during boot to make the same view double as a
   * progress display.
   */
  states?: ReadonlyMap<string, ProcessState>;
  /**
   * Frame index for the braille spinner used by `starting` processes.
   * Increment over time (e.g. via setInterval) to animate. Ignored for other
   * states.
   */
  spinnerFrame?: number;
  /**
   * Per-row trailing annotation rendered after the dependency list — e.g.
   * `(132ms)` for ready processes or `(retry 2)` for restarting ones.
   */
  annotations?: ReadonlyMap<string, string>;
}

/**
 * Render the dependency graph as a wave-grouped tree. Each wave is the set of
 * processes that start in parallel; later waves wait for earlier ones to be
 * ready. The same renderer powers `orc validate` (static, all-pending) and
 * the live boot view (state + spinner + timing annotations).
 */
export function renderGraph(graph: DependencyGraph, opts: RenderGraphOptions = {}): string {
  const waves = groupIntoWaves(graph);
  if (waves.length === 0) return chalk.dim('(no processes)');

  const nameWidth = Math.max(0, ...[...graph.keys()].map((n) => n.length));
  const lines: string[] = [];
  const spinnerIcon = SPINNER_FRAMES[((opts.spinnerFrame ?? 0) % SPINNER_FRAMES.length + SPINNER_FRAMES.length) % SPINNER_FRAMES.length]!;

  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i]!;
    const isFirst = i === 0;
    const isLast = i === waves.length - 1;

    // Single-wave graphs don't need a vertical connector or corner shape;
    // multi-wave graphs draw ┌ / ├ / └ to show the flow between waves.
    const corner = isFirst && isLast ? '─' : isFirst ? '┌' : isLast ? '└' : '├';
    const subtitle = isFirst ? 'starts immediately' : `after wave ${i}`;
    const parallelHint = wave.length > 1 ? chalk.dim(` (${wave.length} in parallel)`) : '';
    lines.push(
      `${chalk.dim(corner + '─')} ${chalk.bold.cyan(`Wave ${i + 1}`)} ${chalk.dim('─── ' + subtitle)}${parallelHint}`,
    );

    const sideBar = isLast ? ' ' : chalk.dim('│');
    for (const name of wave) {
      const state = opts.states?.get(name) ?? 'pending';
      const rawIcon = state === 'starting' ? spinnerIcon : STATE_ICON[state];
      const icon = STATE_COLOR[state](rawIcon);
      const deps = graph.get(name)!;
      const annotation = opts.annotations?.get(name);
      const hasTrailing = deps.length > 0 || annotation;
      // Only pad the name when something follows; otherwise we'd emit trailing
      // whitespace on every leaf row.
      const renderedName = hasTrailing ? name.padEnd(nameWidth) : name;
      const depPart = deps.length > 0 ? `  ${chalk.dim('← ' + deps.join(', '))}` : '';
      const annPart = annotation ? `  ${annotation}` : '';
      lines.push(`${sideBar}  ${icon} ${renderedName}${depPart}${annPart}`);
    }
    if (!isLast) lines.push(sideBar);
  }
  return lines.join('\n');
}
