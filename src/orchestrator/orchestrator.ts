import { EventEmitter } from 'node:events';
import type { OrckitConfig, ProcessConfig } from '../config/schema.js';
import {
  buildGraph,
  filterToTargets,
  groupIntoWaves,
  resolveStartOrder,
  transitiveDependents,
  type DependencyGraph,
} from '../graph/resolver.js';
import { createProbe, readyCheckLocalEndpoint, type HealthProbe } from '../health/checks.js';
import { HealthTimeoutError, waitForReady } from '../health/wait.js';
import { Runner } from '../process/runner.js';
import { OutputBuffer, type OutputLine } from '../process/output.js';
import { getParser, type BuildEvent, type LineParser } from '../process/parsers.js';
import { isPortFree } from '../util/port.js';
import {
  isActive,
  isReadyOrDone,
  transition,
  type LifecycleEvent,
  type ProcessState,
} from './lifecycle.js';
import { runHook, type HookKind } from './hooks.js';
import { applyDockerDefaults, runDockerOrphanCleanup } from './docker.js';
import { PreflightError, runPreflight, type PreflightResult } from './preflight.js';

export interface BootSummary {
  ready: string[];
  failed: string[];
  pending: string[];
  /**
   * Subset of `failed` that did NOT opt into `manual_retry: true`. When this
   * is non-empty, `start()` will throw `BootFailedError` immediately after
   * emitting `boot:complete` — reporters should treat the boot as fatal and
   * not suggest a retry.
   */
  strictFailures: string[];
}

/**
 * Thrown by `start()` when one or more processes that are NOT marked
 * `manual_retry: true` failed during boot. The orchestrator's other
 * processes will already have been started but the boot is considered
 * fatal — the caller should typically tear down and exit.
 */
export class BootFailedError extends Error {
  constructor(
    public readonly strictFailures: string[],
    public readonly summary: BootSummary,
  ) {
    super(`boot failed: ${strictFailures.join(', ')}`);
    this.name = 'BootFailedError';
  }
}

export type OrckitEvents = {
  'preflight:start': [];
  'preflight:result': [result: PreflightResult];
  'preflight:complete': [allPassed: boolean];
  'process:state': [name: string, state: ProcessState];
  'process:starting': [name: string];
  'process:ready': [name: string, durationMs: number];
  'process:running': [name: string];
  'process:finished': [name: string, durationMs: number];
  'process:stopped': [name: string];
  'process:failed': [name: string, error?: Error];
  'process:restarting': [name: string, attempt: number];
  'process:line': [name: string, line: OutputLine];
  'process:build': [name: string, event: BuildEvent];
  'hook:start': [name: string, hook: HookKind];
  'hook:complete': [name: string, hook: HookKind];
  'hook:failed': [name: string, hook: HookKind, error: Error];
  'boot:complete': [summary: BootSummary];
  'all:ready': [names: string[]];
};

interface Handle {
  state: ProcessState;
  config: ProcessConfig;
  runner: Runner | null;
  probe: HealthProbe | null;
  buffer: OutputBuffer;
  parser: LineParser | null;
  retries: number;
  shutdown: AbortController | null;
  restartAbort: AbortController | null;
  startedAt: number | null;
}

export interface RestartOptions {
  /** When true (default), also restart all transitive dependents of each target. */
  cascade?: boolean;
}

export class Orckit extends EventEmitter<OrckitEvents> {
  private readonly graph: DependencyGraph;
  private readonly handles = new Map<string, Handle>();
  private stopping = false;
  private inStartLoop = false;

  constructor(public readonly config: OrckitConfig) {
    super();
    this.graph = buildGraph(config);
    for (const [name, processConfig] of Object.entries(config.processes)) {
      this.handles.set(name, this.makeHandle(processConfig));
    }
  }

  get projectName(): string {
    return this.config.project;
  }

  async start(targets?: string[]): Promise<BootSummary> {
    if (this.config.preflight.length > 0) {
      await this.doPreflight();
    }

    const required =
      targets && targets.length > 0
        ? filterToTargets(this.graph, targets)
        : new Set(resolveStartOrder(this.graph));

    const waves = groupIntoWaves(this.graph)
      .map((wave) => wave.filter((n) => required.has(n)))
      .filter((wave) => wave.length > 0);

    this.inStartLoop = true;
    try {
      for (const wave of waves) {
        const startable = wave.filter((name) => this.depsReady(name));
        if (startable.length === 0) continue;
        await Promise.allSettled(
          startable.map((name) =>
            this.startOne(name).catch(() => {
              // failure already emitted via events; allSettled would have swallowed
              // the rejection anyway, but the explicit .catch avoids unhandled-rejection
              // warnings if anything upstream changes.
            }),
          ),
        );
      }
    } finally {
      this.inStartLoop = false;
    }

    const summary = this.bootSummary(required);
    this.emit('boot:complete', summary);

    if (summary.strictFailures.length > 0) {
      throw new BootFailedError(summary.strictFailures, summary);
    }
    if (summary.failed.length === 0 && summary.pending.length === 0) {
      this.emit('all:ready', summary.ready);
    }
    return summary;
  }

  async stop(targets?: string[]): Promise<void> {
    this.stopping = true;
    // Cancel any pending auto-restart timers up-front so they don't try to revive
    // processes while we're tearing down.
    for (const handle of this.handles.values()) {
      handle.restartAbort?.abort();
    }

    const order = resolveStartOrder(this.graph);
    const toStop = targets && targets.length > 0 ? new Set(targets) : new Set(order);
    const reversed = [...order].reverse().filter((n) => toStop.has(n));
    for (const name of reversed) {
      await this.stopOne(name);
    }
    this.stopping = false;
  }

  async restart(targets: string[], options: RestartOptions = {}): Promise<void> {
    const cascade = options.cascade !== false;

    const toRestart = new Set<string>();
    for (const name of targets) {
      if (!this.handles.has(name)) {
        throw new Error(`unknown process "${name}"`);
      }
      toRestart.add(name);
      if (cascade) {
        for (const dep of transitiveDependents(this.graph, name)) {
          toRestart.add(dep);
        }
      }
    }

    // Cancel any pending auto-restart timers for the targets so manual retry
    // doesn't race with the auto-retry that's already queued.
    for (const name of toRestart) {
      this.handles.get(name)!.restartAbort?.abort();
    }

    const order = resolveStartOrder(this.graph);
    const stopOrder = [...order].reverse().filter((n) => toRestart.has(n));
    const startOrder = order.filter((n) => toRestart.has(n));

    for (const name of stopOrder) {
      await this.stopOne(name);
    }
    this.inStartLoop = true;
    try {
      for (const name of startOrder) {
        try {
          await this.startOne(name);
        } catch {
          // failure already emitted; keep going so partial recovery still happens
        }
      }
    } finally {
      this.inStartLoop = false;
    }

    // Unblock anything else that was waiting on these.
    this.kickPending();
  }

  state(name: string): ProcessState {
    return this.requireHandle(name).state;
  }

  states(): Map<string, ProcessState> {
    return new Map([...this.handles].map(([n, h]) => [n, h.state]));
  }

  output(name: string, n?: number): OutputLine[] {
    return this.requireHandle(name).buffer.recent(n);
  }

  /**
   * Snapshot of a process's runtime metadata. Exposes the bits of the private
   * `Handle` that consumers (status reporters, MCP server) need without
   * letting them mutate it.
   */
  inspect(name: string): {
    state: ProcessState;
    pid: number | null;
    startedAt: number | null;
    retries: number;
  } {
    const h = this.requireHandle(name);
    return {
      state: h.state,
      pid: h.runner?.pid ?? null,
      startedAt: h.startedAt,
      retries: h.retries,
    };
  }

  async dispose(): Promise<void> {
    await this.stop();
  }

  // ------- internals -------

  private bootSummary(required: ReadonlySet<string>): BootSummary {
    const ready: string[] = [];
    const failed: string[] = [];
    const pending: string[] = [];
    for (const name of required) {
      const state = this.handles.get(name)!.state;
      if (isReadyOrDone(state)) ready.push(name);
      else if (state === 'failed') failed.push(name);
      else if (state === 'pending') pending.push(name);
    }
    const strictFailures = failed.filter((name) => !this.handles.get(name)!.config.manual_retry);
    return { ready, failed, pending, strictFailures };
  }

  private depsReady(name: string): boolean {
    const deps = this.graph.get(name) ?? [];
    return deps.every((d) => {
      const s = this.handles.get(d)?.state;
      return s !== undefined && isReadyOrDone(s);
    });
  }

  /**
   * Start any pending process whose dependencies are now ready. Fire-and-forget.
   * Skipped while a start/restart loop is driving startup itself — that loop
   * awaits each child sequentially and would race with a kicked start.
   */
  private kickPending(): void {
    if (this.inStartLoop) return;
    for (const [name, handle] of this.handles) {
      if (handle.state !== 'pending') continue;
      if (!this.depsReady(name)) continue;
      void this.startOne(name).catch(() => {});
    }
  }

  private async doPreflight(): Promise<void> {
    this.emit('preflight:start');
    const results = await runPreflight(this.config.preflight);
    for (const r of results) this.emit('preflight:result', r);
    const failed = results.filter((r) => !r.passed);
    this.emit('preflight:complete', failed.length === 0);
    if (failed.length > 0) throw new PreflightError(failed);
  }

  private async startOne(name: string): Promise<void> {
    const handle = this.requireHandle(name);
    if (handle.state === 'starting' || handle.state === 'ready' || handle.state === 'running') {
      return;
    }
    handle.retries = 0;
    await this.spawnAndAwaitReady(name);
  }

  private async spawnAndAwaitReady(name: string): Promise<void> {
    const handle = this.requireHandle(name);

    // For `type: docker`, nuke any container left over from a previous run
    // before pre_start. Failures are swallowed inside the helper — the upcoming
    // `docker run` will surface the real error if docker itself is broken.
    await runDockerOrphanCleanup(handle.config);

    await this.runHookSafe(name, 'pre_start');

    this.applyEvent(name, { kind: 'start' });
    this.emit('process:starting', name);

    // Catch the stale-process / port-conflict case before spawn. If the ready
    // check declares a known local port and something is already listening on
    // it, the probe would immediately succeed against that listener and
    // falsely report "ready (Xms)" while the newly spawned command itself
    // fails to bind — that's the confusing "✓ ready" then "✗ failed" sequence.
    // Fail fast with a clear error instead.
    const endpoint = readyCheckLocalEndpoint(handle.config.ready);
    if (endpoint && !(await isPortFree(endpoint.port, endpoint.host))) {
      const err = new Error(
        `port ${endpoint.port} is already in use — another process is bound to it ` +
          `(the ready check would falsely succeed against the existing listener). ` +
          `Stop the other process and retry — \`lsof -i :${endpoint.port}\` shows what's holding it.`,
      );
      this.applyEvent(name, { kind: 'fail' });
      this.emit('process:failed', name, err);
      throw err;
    }

    const runner = new Runner(name, handle.config);
    handle.runner = runner;
    handle.shutdown = new AbortController();
    handle.startedAt = Date.now();

    runner.on('line', (text, stream) => this.handleLine(name, text, stream));
    runner.once('error', (err) => this.emit('process:failed', name, err));

    const ready = handle.config.ready;

    // exit-code processes are special: they MUST exit (and their exit is the ready signal).
    // Do not install the global exit-handler here — we await the exit inline.
    if (ready?.type === 'exit-code') {
      runner.start();
      const code = await new Promise<number | null>((resolve) => {
        runner.once('exit', (c) => resolve(c));
      });
      handle.runner = null;
      if (code !== 0) {
        this.applyEvent(name, { kind: 'fail' });
        this.emit('process:failed', name, new Error(`exited with code ${code}`));
        throw new Error(`process "${name}" exited with code ${code}`);
      }
      this.markReadyAndFinished(name);
      await this.runHookSafe(name, 'post_start');
      return;
    }

    // Long-running paths install the global exit handler before start so unexpected
    // exits (during health check or later) flow through one place.
    runner.once('exit', (code, signal) => this.handleExit(name, code, signal));
    runner.start();

    if (!ready) {
      this.markReadyAndRunning(name);
      await this.runHookSafe(name, 'post_start');
      return;
    }

    const probe = createProbe(ready);
    handle.probe = probe;
    try {
      const exitDuringHealth = new Promise<never>((_, reject) => {
        runner.once('exit', (code) =>
          reject(new Error(`process exited (code ${code ?? '?'}) during health check`)),
        );
      });
      await Promise.race([
        waitForReady(probe, { signal: handle.shutdown.signal }),
        exitDuringHealth,
      ]);
    } catch (err) {
      if (runner.running) await runner.stop();
      // handleExit (if it fired) will already have transitioned to failed; otherwise do it here.
      if (handle.state !== 'failed') {
        this.applyEvent(name, { kind: 'fail' });
        this.emit('process:failed', name, err as Error);
      }
      throw err instanceof HealthTimeoutError
        ? new Error(`"${name}" did not become ready: ${err.message}`)
        : (err as Error);
    }

    this.markReadyAndRunning(name);
    await this.runHookSafe(name, 'post_start');
  }

  private markReadyAndRunning(name: string): void {
    this.applyEvent(name, { kind: 'ready' });
    const handle = this.handles.get(name)!;
    this.emit('process:ready', name, Date.now() - (handle.startedAt ?? Date.now()));
    this.applyEvent(name, { kind: 'mark-running' });
    this.emit('process:running', name);
    this.kickPending();
  }

  private markReadyAndFinished(name: string): void {
    // For one-shot (exit-code) processes the "ready" transition coincides with
    // process completion — we skip emitting `process:ready` and let consumers
    // observe `process:finished` (which carries the duration) instead.
    this.applyEvent(name, { kind: 'ready' });
    this.applyEvent(name, { kind: 'mark-finished' });
    const handle = this.handles.get(name)!;
    this.emit('process:finished', name, Date.now() - (handle.startedAt ?? Date.now()));
    this.kickPending();
  }

  private async stopOne(name: string): Promise<void> {
    const handle = this.requireHandle(name);
    if (!isActive(handle.state)) return;

    await this.runHookSafe(name, 'pre_stop');

    this.applyEvent(name, { kind: 'stop-requested' });
    handle.shutdown?.abort();
    if (handle.runner?.running) {
      await handle.runner.stop();
    }
    // exit handler fires applyEvent('exited', expected=true)
    await this.runHookSafe(name, 'post_stop');
  }

  private handleLine(name: string, text: string, stream: 'stdout' | 'stderr'): void {
    const handle = this.handles.get(name);
    if (!handle) return;
    const line = handle.buffer.push(text, stream);
    if (line) this.emit('process:line', name, line);

    if (handle.probe?.feedLine) handle.probe.feedLine(text);
    if (handle.parser) {
      const event = handle.parser(text);
      if (event) this.emit('process:build', name, event);
    }
  }

  private handleExit(name: string, code: number | null, signal: NodeJS.Signals | null): void {
    void signal;
    const handle = this.handles.get(name);
    if (!handle) return;
    const expected = handle.state === 'stopping' || this.stopping;
    handle.runner = null;
    handle.probe = null;
    this.applyEvent(name, { kind: 'exited', expected, code });
    if (handle.state === 'stopped') {
      this.emit('process:stopped', name);
      // A clean exit we didn't request still warrants a restart under `restart: always`.
      if (!expected) void this.maybeRestart(name);
      return;
    }
    this.emit('process:failed', name, new Error(`exited (code ${code ?? '?'})`));
    void this.maybeRestart(name);
  }

  private async maybeRestart(name: string): Promise<void> {
    if (this.stopping) return;
    const handle = this.handles.get(name);
    if (!handle) return;
    const policy = handle.config.restart;
    if (policy === 'never') return;
    if (policy === 'on-failure' && handle.state !== 'failed') return;
    if (handle.retries >= handle.config.max_retries) return;

    handle.retries++;
    this.emit('process:restarting', name, handle.retries);

    // Abortable delay so a manual restart can preempt the queued auto-retry.
    const abort = new AbortController();
    handle.restartAbort = abort;
    try {
      await delay(handle.config.restart_delay_ms, abort.signal);
    } catch {
      handle.restartAbort = null;
      return;
    }
    handle.restartAbort = null;

    try {
      await this.spawnAndAwaitReady(name);
      this.kickPending();
    } catch {
      // failure already emitted; recursion via handleExit will retry if budget remains
    }
  }

  private async runHookSafe(name: string, hook: HookKind): Promise<void> {
    const handle = this.handles.get(name);
    if (!handle?.config.hooks?.[hook]) return;
    this.emit('hook:start', name, hook);
    try {
      await runHook(hook, handle.config.hooks, {
        cwd: handle.config.cwd,
        env: handle.config.env,
      });
      this.emit('hook:complete', name, hook);
    } catch (err) {
      this.emit('hook:failed', name, hook, err as Error);
      throw err;
    }
  }

  private applyEvent(name: string, event: LifecycleEvent): void {
    const handle = this.handles.get(name);
    if (!handle) return;
    const next = transition(handle.state, event);
    if (next === handle.state) return;
    handle.state = next;
    this.emit('process:state', name, next);
  }

  private makeHandle(rawConfig: ProcessConfig): Handle {
    const config = applyDockerDefaults(rawConfig);
    return {
      state: 'pending',
      config,
      runner: null,
      probe: null,
      buffer: new OutputBuffer(config.buffer_size, config.output),
      parser: getParser(config.type),
      retries: 0,
      shutdown: null,
      restartAbort: null,
      startedAt: null,
    };
  }

  private requireHandle(name: string): Handle {
    const handle = this.handles.get(name);
    if (!handle) throw new Error(`unknown process "${name}"`);
    return handle;
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
