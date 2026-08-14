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
import { isPortFree, killPortHolders } from '../util/port.js';
import {
  isActive,
  isReadyOrDone,
  transition,
  type LifecycleEvent,
  type ProcessState,
} from './lifecycle.js';
import { runHook, type HookKind } from './hooks.js';
import { removeDockerContainer, removeDockerContainerSync } from './docker.js';
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

/**
 * Thrown (internally) by a startup that was cancelled because a shutdown or
 * restart landed while it was still in flight — mid `pre_start` hook, between
 * hook and spawn, or during the health wait. It deliberately does NOT mark the
 * process `failed`: a cancelled start is not a failure, and treating it as one
 * would turn every Ctrl-C during boot into a spurious `BootFailedError`.
 */
export class StartupAbortedError extends Error {
  constructor(name: string) {
    super(`startup of "${name}" aborted by shutdown`);
    this.name = 'StartupAbortedError';
  }
}

export type OrckitEvents = {
  'preflight:start': [];
  'preflight:result': [result: PreflightResult];
  'preflight:complete': [allPassed: boolean];
  'process:state': [name: string, state: ProcessState];
  'process:starting': [name: string];
  /**
   * The subprocess exists: `pid` is also its process-group id (children are
   * spawned detached). Emitted once per spawn attempt, before any ready check.
   * Consumers that need to reach the OS process — session tracking, external
   * supervisors — should key off this rather than `process:starting`, which
   * fires before the spawn.
   */
  'process:spawned': [name: string, pid: number, command: string];
  'process:ready': [name: string, durationMs: number];
  'process:running': [name: string];
  'process:finished': [name: string, durationMs: number];
  'process:stopping': [name: string];
  'process:killed': [name: string, signal: NodeJS.Signals];
  'process:port-freed': [name: string, port: number, pid: number];
  /**
   * A descendant of this process escaped the process group and survived
   * SIGKILL of the tree — teardown could not prove it was reaped. Rare; the
   * fix is usually declaring the process's `ports` with `kill_orphan_ports`.
   */
  'process:escaped': [name: string];
  'process:stopped': [name: string, durationMs?: number];
  'process:failed': [name: string, error?: Error];
  'process:restarting': [name: string, attempt: number];
  'process:line': [name: string, line: OutputLine];
  'process:build': [name: string, event: BuildEvent];
  'hook:start': [name: string, hook: HookKind];
  'hook:line': [name: string, hook: HookKind, text: string, stream: 'stdout' | 'stderr'];
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
  /**
   * Abort controller for the CURRENT startup attempt, created before the
   * pre_start hook runs (so a stop can cancel the hook, not just the health
   * wait). Aborting it makes the in-flight `spawnAndAwaitReady` unwind with
   * `StartupAbortedError` instead of spawning/continuing.
   */
  shutdown: AbortController | null;
  /**
   * The in-flight `spawnAndAwaitReady` promise, if any. `stopOne` awaits it
   * (after aborting) so teardown can't complete while a startup is still
   * running — the exact race that used to spawn a detached child AFTER
   * shutdown had finished.
   */
  startup: Promise<void> | null;
  restartAbort: AbortController | null;
  startedAt: number | null;
  stoppingAt: number | null;
}

export interface RestartOptions {
  /** When true (default), also restart all transitive dependents of each target. */
  cascade?: boolean;
}

export class Orckit extends EventEmitter<OrckitEvents> {
  private readonly graph: DependencyGraph;
  private readonly handles = new Map<string, Handle>();
  private stopping = false;
  /** Set once by dispose(); permanently blocks every spawn path afterwards. */
  private disposed = false;
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
    if (this.disposed) {
      throw new Error('orchestrator has been disposed — create a new Orckit to start again');
    }
    if (this.config.preflight.length > 0) {
      await this.doPreflight();
    }

    // With explicit targets, honor them as-is (an explicit `orc start foo`
    // boots an optional foo). Without targets, skip optional processes —
    // they only start when explicitly named or via startTargets() at runtime.
    const required =
      targets && targets.length > 0
        ? filterToTargets(this.graph, targets)
        : new Set(
            resolveStartOrder(this.graph).filter(
              (name) => !this.handles.get(name)!.config.optional,
            ),
          );

    const waves = groupIntoWaves(this.graph)
      .map((wave) => wave.filter((n) => required.has(n)))
      .filter((wave) => wave.length > 0);

    this.inStartLoop = true;
    try {
      for (const wave of waves) {
        // A shutdown that landed mid-boot must stop the wave driver too —
        // otherwise later waves would keep spawning into the teardown.
        if (this.stopping || this.disposed) break;
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
    if (
      summary.failed.length === 0 &&
      summary.pending.length === 0 &&
      summary.ready.length > 0 &&
      !this.stopping &&
      !this.disposed
    ) {
      this.emit('all:ready', summary.ready);
    }
    return summary;
  }

  async stop(targets?: string[]): Promise<void> {
    const order = resolveStartOrder(this.graph);
    const fullStop = !targets || targets.length === 0;
    const toStop = fullStop ? new Set(order) : new Set(targets);

    // The global `stopping` flag suppresses every spawn path (wave loop,
    // kickPending, maybeRestart, in-flight startups). Only a FULL stop may set
    // it — a targeted stop of one process must not classify an unrelated
    // concurrent crash as "expected" or block unrelated restarts.
    if (fullStop) this.stopping = true;
    // Cancel pending auto-restart timers for the processes being stopped so
    // they don't try to revive them while we're tearing down.
    for (const name of toStop) {
      this.handles.get(name)?.restartAbort?.abort();
    }
    // Tear processes down in parallel. Each stopOne() waits up to the per-process
    // grace window (10s) for a clean exit before escalating to SIGKILL; doing
    // them sequentially would sum those windows — with a dozen processes that's
    // a minute-plus of apparent hang on Ctrl-C. A hard shutdown doesn't need the
    // reverse-dependency ordering a rolling `restart()` does: every process is
    // going away, so signal them all at once (this also matches how the terminal
    // used to broadcast SIGINT to the whole process group simultaneously).
    const stopping = [...order].filter((n) => toStop.has(n)).map((n) => this.stopOne(n));
    await Promise.all(stopping);
    // A disposed orchestrator stays stopping forever; a resettable full stop
    // may be followed by a fresh start() (library/test usage).
    if (fullStop && !this.disposed) this.stopping = false;
  }

  /**
   * Start additional processes at runtime, after the initial `start()` boot.
   * Pulls in transitive dependencies (skipping any already in a ready/running
   * state). Does NOT emit `boot:complete` or `all:ready`, and does NOT throw
   * `BootFailedError` — the caller already chose to add these, so a failure
   * is theirs to handle (typically by retrying via the REPL or web UI).
   *
   * Use for optional processes, on-demand admin tools, or anything you didn't
   * include in the original boot set.
   */
  async startTargets(targets: string[]): Promise<void> {
    if (targets.length === 0) return;
    if (this.stopping || this.disposed) {
      throw new Error('orchestrator is shutting down — cannot start processes');
    }

    const required = filterToTargets(this.graph, targets);
    const order = resolveStartOrder(this.graph).filter((n) => required.has(n));

    this.inStartLoop = true;
    try {
      for (const name of order) {
        const handle = this.requireHandle(name);
        // Skip anything already healthy — typical case for shared deps that
        // were started by the initial boot.
        if (isReadyOrDone(handle.state) || handle.state === 'starting') continue;
        try {
          await this.startOne(name);
        } catch {
          // failure already emitted; keep going so later targets still get a chance
        }
      }
    } finally {
      this.inStartLoop = false;
    }
    this.kickPending();
  }

  async restart(targets: string[], options: RestartOptions = {}): Promise<void> {
    if (this.stopping || this.disposed) {
      throw new Error('orchestrator is shutting down — cannot restart processes');
    }
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
    // One-way latch: from here on no spawn path (start, startTargets, restart,
    // kickPending, maybeRestart, web/MCP action endpoints) may create a child.
    this.disposed = true;
    this.stopping = true;
    await this.stop();
  }

  /**
   * Last-ditch, fully SYNCHRONOUS kill sweep for crash paths
   * (uncaughtException / unhandledRejection) where no async teardown can be
   * awaited. SIGKILLs every live runner's process group. Skips hooks, docker
   * cleanup and port sweeps — this is strictly better than exiting with the
   * children alive, not a replacement for `dispose()`.
   */
  emergencyKill(): void {
    this.disposed = true;
    this.stopping = true;
    for (const handle of this.handles.values()) {
      handle.restartAbort?.abort();
      handle.shutdown?.abort();
      const pid = handle.runner?.pid;
      if (pid != null && handle.runner?.running) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // group already gone
        }
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // process already gone
        }
      }
      // Containers are owned by the daemon: killing the `docker run` client
      // does not stop them, so they'd survive with their ports bound.
      removeDockerContainerSync(handle.config);
    }
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
    if (this.inStartLoop || this.stopping || this.disposed) return;
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

  private spawnAndAwaitReady(name: string): Promise<void> {
    const handle = this.requireHandle(name);
    // Track the in-flight startup on the handle so stopOne() can await it —
    // teardown must not complete while a startup is still unwinding, or the
    // startup's spawn can land AFTER shutdown finished (a permanent orphan,
    // since children are detached and never see the terminal's Ctrl-C).
    const startup = this.doSpawnAndAwaitReady(name).finally(() => {
      if (handle.startup === startup) handle.startup = null;
    });
    handle.startup = startup;
    return startup;
  }

  private async doSpawnAndAwaitReady(name: string): Promise<void> {
    const handle = this.requireHandle(name);
    if (this.stopping || this.disposed) throw new StartupAbortedError(name);

    // Per-attempt abort, created BEFORE any await so a stop that lands at any
    // point of the startup — docker cleanup, pre_start hook, port probe,
    // health wait — can cancel it. stopOne() aborts this regardless of state.
    const abort = new AbortController();
    handle.shutdown = abort;
    const cancelled = () => abort.signal.aborted || this.stopping || this.disposed;

    // For `type: docker`, nuke any container left over from a previous run
    // before pre_start. Failures are swallowed inside the helper — the upcoming
    // `docker run` will surface the real error if docker itself is broken.
    await removeDockerContainer(handle.config);
    if (cancelled()) throw new StartupAbortedError(name);

    // A failing pre_start hook runs BEFORE the process transitions out of
    // `pending`, so without this it would throw and leave the process stuck in
    // `pending` — boot neither aborts (no `failed` process) nor surfaces it.
    // Mark it `failed` so it flows through the normal strict-failure / manual_retry
    // path like any other spawn failure.
    try {
      await this.runHookSafe(name, 'pre_start', abort.signal);
    } catch (err) {
      if (cancelled()) throw new StartupAbortedError(name);
      this.applyEvent(name, { kind: 'fail' });
      this.emit('process:failed', name, err as Error);
      throw err;
    }

    // THE window that used to orphan processes: a Ctrl-C during a long
    // `pnpm install` pre_start hook finished teardown while the hook was
    // still running, then the spawn below fired into the void.
    if (cancelled()) throw new StartupAbortedError(name);

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
      if (cancelled()) throw new StartupAbortedError(name);
      const err = new Error(
        `port ${endpoint.port} is already in use — another process is bound to it ` +
          `(the ready check would falsely succeed against the existing listener). ` +
          `Stop the other process and retry — \`lsof -i :${endpoint.port}\` shows what's holding it.`,
      );
      this.applyEvent(name, { kind: 'fail' });
      this.emit('process:failed', name, err);
      throw err;
    }
    // Last guard before the point of no return: never spawn into a teardown.
    if (cancelled()) throw new StartupAbortedError(name);

    const runner = new Runner(name, handle.config);
    handle.runner = runner;
    handle.startedAt = Date.now();

    runner.on('line', (text, stream) => this.handleLine(name, text, stream));
    runner.on('kill', (signal) => this.emit('process:killed', name, signal));
    runner.on('port_freed', (port, pid) => this.emit('process:port-freed', name, port, pid));
    runner.on('escaped', () => this.emit('process:escaped', name));
    runner.once('error', (err) => this.emit('process:failed', name, err));

    const ready = handle.config.ready;

    // exit-code processes are special: they MUST exit (and their exit is the ready signal).
    // Do not install the global exit-handler here — we await the exit inline.
    if (ready?.type === 'exit-code') {
      runner.start();
      this.announceSpawn(name, runner);
      const code = await new Promise<number | null>((resolve) => {
        runner.once('exit', (c) => resolve(c));
      });
      handle.runner = null;
      if (code !== 0) {
        // Killed by shutdown/restart (stopOne stopped the runner): not a
        // failure. stopOne's post-await fix-up transitions stopping → stopped.
        if (cancelled()) throw new StartupAbortedError(name);
        this.applyEvent(name, { kind: 'fail' });
        this.emit('process:failed', name, new Error(`exited with code ${code}`));
        throw new Error(`process "${name}" exited with code ${code}`);
      }
      this.markReadyAndFinished(name);
      await this.runHookSafe(name, 'post_start', abort.signal);
      return;
    }

    // Long-running paths install the global exit handler before start so unexpected
    // exits (during health check or later) flow through one place.
    runner.once('exit', (code, signal) => this.handleExit(name, code, signal));
    runner.start();
    this.announceSpawn(name, runner);

    if (!ready) {
      this.markReadyAndRunning(name);
      await this.runHookSafe(name, 'post_start', abort.signal);
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
        waitForReady(probe, { signal: abort.signal }),
        exitDuringHealth,
      ]);
      // The probe may report ready in the same tick a stop lands; never
      // continue a cancelled startup into markReadyAndRunning (it would be an
      // illegal stopping → ready transition and leave the child untracked).
      if (cancelled()) throw new StartupAbortedError(name);
    } catch (err) {
      if (runner.running) await runner.stop();
      if (cancelled()) {
        // Cancelled by shutdown/restart — not a failure. stopOne() owns the
        // state transitions (stop-requested before, stopped after the exit).
        throw err instanceof StartupAbortedError ? err : new StartupAbortedError(name);
      }
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
    await this.runHookSafe(name, 'post_start', abort.signal);
  }

  private announceSpawn(name: string, runner: Runner): void {
    const pid = runner.pid;
    if (pid != null) this.emit('process:spawned', name, pid, runner.config.command);
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

    if (!isActive(handle.state)) {
      // Not (yet) running — but a startup may be in flight (state `pending`
      // while its pre_start hook runs). Abort it and wait for it to unwind so
      // the hook subprocess is killed and the spawn behind it can never fire.
      handle.shutdown?.abort();
      if (handle.startup) await handle.startup.catch(() => {});
      // An earlier attempt may still have left a container behind (a process
      // that reached `failed` after `docker run` created one). The container is
      // owned by the daemon, so it outlives us and keeps its ports bound.
      await removeDockerContainer(handle.config);
      return;
    }

    // A failing/timing-out pre_stop hook must never block the actual kill —
    // otherwise one bad hook aborts the whole teardown and orphans everything
    // still inside its grace window. `runHookSafe` already emits hook:failed.
    await this.runHookSafe(name, 'pre_stop').catch(() => {});

    this.applyEvent(name, { kind: 'stop-requested' });
    handle.stoppingAt = Date.now();
    this.emit('process:stopping', name);
    handle.shutdown?.abort();
    if (handle.runner?.running) {
      await handle.runner.stop(handle.config.stop_grace_ms);
    }
    // Wait for any in-flight startup (health wait, exit-code wait) to unwind —
    // its catch path may still be stopping the runner (Runner.stop is
    // single-flight, so this never doubles the teardown).
    if (handle.startup) await handle.startup.catch(() => {});
    // exit handler fires applyEvent('exited', expected=true). Exit-code
    // startups install no exit handler, so a process killed while awaiting its
    // one-shot exit would stay stuck in `stopping` — settle it here.
    if (handle.state === 'stopping') {
      handle.runner = null;
      handle.probe = null;
      this.applyEvent(name, { kind: 'exited', expected: true, code: null });
      const stopMs = handle.stoppingAt != null ? Date.now() - handle.stoppingAt : undefined;
      handle.stoppingAt = null;
      this.emit('process:stopped', name, stopMs);
    }
    // For `type: docker`, the local `docker run` CLI we just signalled doesn't
    // own the container — force-remove it so its published ports are freed for
    // the next boot, regardless of whether the process stopped gracefully or
    // was SIGKILLed. No-op for every other process type.
    await removeDockerContainer(handle.config);
    await this.runHookSafe(name, 'post_stop').catch(() => {});
    await this.sweepOrphanPorts(name);
  }

  /**
   * Post-stop backstop for `kill_orphan_ports`: once the normal teardown has run
   * (SIGTERM → grace → SIGKILL of the whole tree, docker cleanup, post_stop),
   * force-kill anything still bound to one of this process's declared `ports`
   * (plus its tcp ready-check port). This is what reaps children that escaped the
   * process group and kept a port held — classically the JVM Firebase emulators.
   * No-op unless the process opted in. Emits `process:port-freed` per reaped pid.
   */
  private async sweepOrphanPorts(name: string): Promise<void> {
    const handle = this.handles.get(name);
    if (!handle?.config.kill_orphan_ports) return;
    const ports = new Set(handle.config.ports);
    const endpoint = readyCheckLocalEndpoint(handle.config.ready);
    if (endpoint) ports.add(endpoint.port);
    if (ports.size === 0) return;
    const freed = await killPortHolders([...ports]);
    for (const { port, pid } of freed) this.emit('process:port-freed', name, port, pid);
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
    const expected = handle.state === 'stopping' || this.stopping || this.disposed;
    handle.runner = null;
    handle.probe = null;
    this.applyEvent(name, { kind: 'exited', expected, code });
    if (handle.state === 'stopped') {
      const stopMs = handle.stoppingAt != null ? Date.now() - handle.stoppingAt : undefined;
      handle.stoppingAt = null;
      this.emit('process:stopped', name, stopMs);
      // A clean exit we didn't request still warrants a restart under `restart: always`.
      if (!expected) void this.maybeRestart(name);
      return;
    }
    this.emit('process:failed', name, new Error(`exited (code ${code ?? '?'})`));
    void this.maybeRestart(name);
  }

  private async maybeRestart(name: string): Promise<void> {
    if (this.stopping || this.disposed) return;
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
    // A stop may have landed while the delay ran (or in the same tick the
    // abort would have fired) — never respawn into a teardown.
    if (this.stopping || this.disposed) return;

    try {
      await this.spawnAndAwaitReady(name);
      this.kickPending();
    } catch {
      // failure already emitted; recursion via handleExit will retry if budget remains
    }
  }

  private async runHookSafe(name: string, hook: HookKind, cancelSignal?: AbortSignal): Promise<void> {
    const handle = this.handles.get(name);
    if (!handle?.config.hooks?.[hook]) return;
    this.emit('hook:start', name, hook);
    try {
      await runHook(hook, handle.config.hooks, {
        cwd: handle.config.cwd,
        env: handle.config.env,
        timeoutMs: handle.config.hook_timeout_ms,
        cancelSignal,
        onLine: (text, stream) => this.emit('hook:line', name, hook, text, stream),
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

  private makeHandle(config: ProcessConfig): Handle {
    return {
      state: 'pending',
      config,
      runner: null,
      probe: null,
      buffer: new OutputBuffer(config.buffer_size, config.output),
      parser: getParser(config.type),
      retries: 0,
      shutdown: null,
      startup: null,
      restartAbort: null,
      startedAt: null,
      stoppingAt: null,
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
