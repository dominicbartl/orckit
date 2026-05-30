import chalk from 'chalk';
import type { Orckit } from '../orchestrator/orchestrator.js';
import type { OutputLine } from '../process/output.js';
import type { HookKind } from '../orchestrator/hooks.js';
import { formatDuration } from '../config/duration.js';

export interface ShutdownReporterOptions {
  /**
   * Where to send output. Defaults to `console.log`. The CLI disposes the live
   * dashboard before attaching this, so plain stdout is the normal sink.
   */
  out?: (msg: string) => void;
}

/**
 * Verbose teardown log, attached by the CLI for the duration of a shutdown
 * (Ctrl-C / boot failure). It answers "what is stopping, did it stop, did it
 * time out?" and pipes each process's and hook's output as it drains so the user
 * can see a stuck process explaining itself.
 *
 * Two visual tiers keep status legible amid piped output:
 *   - **status** lines are icon-led at a 2-space indent (`  ⠿ db stopping`);
 *   - **piped** output sits deeper (6 spaces) and is tagged with the process
 *     name + a stream marker, so the interleaving from parallel teardown stays
 *     attributable: `      db │ shutting down`.
 *
 * Returns a detach function. Intended to be the sole shutdown UI — the CLI
 * detaches the normal reporter first so stop lines aren't printed twice.
 */
export function attachShutdownReporter(
  orckit: Orckit,
  opts: ShutdownReporterOptions = {},
): () => void {
  const out = opts.out ?? ((msg: string) => console.log(msg));
  // Processes that needed a SIGKILL — so the final `stopped` line can flag that
  // it didn't come down cleanly.
  const forced = new Set<string>();

  const pipe = (name: string, marker: string, text: string) =>
    out(`      ${chalk.dim(name)} ${marker} ${text}`);

  const onStopping = (name: string) =>
    out(`  ${chalk.yellow('⠿')} ${chalk.bold(name)} ${chalk.dim('stopping')}`);

  const onLine = (name: string, line: OutputLine) => {
    if (line.stream === 'stderr') pipe(name, chalk.red('!'), chalk.red(line.text));
    else pipe(name, chalk.dim('│'), chalk.dim(line.text));
  };

  const onHookStart = (name: string, hook: HookKind) =>
    out(`  ${chalk.dim('↪')} ${chalk.bold(name)} ${chalk.dim(`${hook} hook`)}`);

  const onHookLine = (name: string, _hook: HookKind, text: string, stream: 'stdout' | 'stderr') => {
    if (stream === 'stderr') pipe(name, chalk.red('↪'), chalk.red(text));
    else pipe(name, chalk.dim('↪'), chalk.dim(text));
  };

  const onHookFailed = (name: string, hook: HookKind, err?: Error) =>
    out(
      `  ${chalk.red('↪')} ${chalk.bold(name)} ${chalk.red(`${hook} hook failed${err ? `: ${err.message}` : ''}`)}`,
    );

  const onKilled = (name: string, signal: NodeJS.Signals) => {
    // SIGTERM is the normal graceful nudge (already covered by `stopping`); only
    // the SIGKILL escalation — i.e. a process that blew past its grace window —
    // is worth a loud line.
    if (signal !== 'SIGKILL') return;
    forced.add(name);
    out(
      `  ${chalk.yellow('⚠')} ${chalk.bold(name)} ${chalk.yellow('did not exit in time — force killing (SIGKILL)')}`,
    );
  };

  const onPortFreed = (name: string, port: number, pid: number) =>
    out(
      `  ${chalk.yellow('⚑')} ${chalk.bold(name)} ${chalk.yellow(`freed port ${port}`)} ${chalk.dim(`(killed orphan pid ${pid})`)}`,
    );

  const onStopped = (name: string, durationMs?: number) => {
    const took = durationMs != null ? chalk.dim(` (${formatDuration(durationMs)})`) : '';
    if (forced.has(name)) {
      out(`  ${chalk.yellow('✓')} ${chalk.bold(name)} ${chalk.yellow('stopped (forced)')}${took}`);
    } else {
      out(`  ${chalk.green('✓')} ${chalk.bold(name)} ${chalk.green('stopped')}${took}`);
    }
  };

  orckit.on('process:stopping', onStopping);
  orckit.on('process:line', onLine);
  orckit.on('hook:start', onHookStart);
  orckit.on('hook:line', onHookLine);
  orckit.on('hook:failed', onHookFailed);
  orckit.on('process:killed', onKilled);
  orckit.on('process:port-freed', onPortFreed);
  orckit.on('process:stopped', onStopped);

  return () => {
    orckit.off('process:stopping', onStopping);
    orckit.off('process:line', onLine);
    orckit.off('hook:start', onHookStart);
    orckit.off('hook:line', onHookLine);
    orckit.off('hook:failed', onHookFailed);
    orckit.off('process:killed', onKilled);
    orckit.off('process:port-freed', onPortFreed);
    orckit.off('process:stopped', onStopped);
  };
}
