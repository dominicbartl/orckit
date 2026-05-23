import { EventEmitter } from 'node:events';
import type { OrckitConfig, ProcessConfig } from '../config/schema.js';
import {
  buildGraph,
  filterToTargets,
  groupIntoWaves,
  resolveStartOrder,
  type DependencyGraph,
} from '../graph/resolver.js';
import { createProbe, type HealthProbe } from '../health/checks.js';
import { HealthTimeoutError, waitForReady } from '../health/wait.js';
import { Runner } from '../process/runner.js';
import { OutputBuffer, type OutputLine } from '../process/output.js';
import { getParser, type BuildEvent, type LineParser } from '../process/parsers.js';
import { isActive, transition, type LifecycleEvent, type ProcessState } from './lifecycle.js';
import { runHook, type HookKind } from './hooks.js';
import { PreflightError, runPreflight, type PreflightResult } from './preflight.js';

export type OrckitEvents = {
  'preflight:start': [];
  'preflight:result': [result: PreflightResult];
  'preflight:complete': [allPassed: boolean];
  'process:state': [name: string, state: ProcessState];
  'process:starting': [name: string];
  'process:ready': [name: string, durationMs: number];
  'process:running': [name: string];
  'process:stopped': [name: string];
  'process:failed': [name: string, error?: Error];
  'process:restarting': [name: string, attempt: number];
  'process:line': [name: string, line: OutputLine];
  'process:build': [name: string, event: BuildEvent];
  'hook:start': [name: string, hook: HookKind];
  'hook:complete': [name: string, hook: HookKind];
  'hook:failed': [name: string, hook: HookKind, error: Error];
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
  startedAt: number | null;
}

export class Orckit extends EventEmitter<OrckitEvents> {
  private readonly graph: DependencyGraph;
  private readonly handles = new Map<string, Handle>();
  private stopping = false;

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

  async start(targets?: string[]): Promise<void> {
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

    for (const wave of waves) {
      await Promise.all(wave.map((name) => this.startOne(name)));
    }

    this.emit('all:ready', [...required]);
  }

  async stop(targets?: string[]): Promise<void> {
    this.stopping = true;
    const order = resolveStartOrder(this.graph);
    const toStop = targets && targets.length > 0 ? new Set(targets) : new Set(order);
    const reversed = [...order].reverse().filter((n) => toStop.has(n));
    for (const name of reversed) {
      await this.stopOne(name);
    }
    this.stopping = false;
  }

  async restart(targets: string[]): Promise<void> {
    for (const name of targets) {
      await this.stopOne(name);
      await this.startOne(name);
    }
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

  async dispose(): Promise<void> {
    await this.stop();
  }

  // ------- internals -------

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

    await this.runHookSafe(name, 'pre_start');

    this.applyEvent(name, { kind: 'start' });
    this.emit('process:starting', name);

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
      this.markReadyAndRunning(name);
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
    this.applyEvent(name, { kind: 'exited', expected });
    if (handle.state === 'stopped') {
      this.emit('process:stopped', name);
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
    if (handle.retries >= handle.config.max_retries) return;

    handle.retries++;
    this.emit('process:restarting', name, handle.retries);
    await delay(handle.config.restart_delay_ms);
    try {
      await this.spawnAndAwaitReady(name);
      if (handle.state === 'ready') {
        this.applyEvent(name, { kind: 'mark-running' });
        this.emit('process:running', name);
      }
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
      startedAt: null,
    };
  }

  private requireHandle(name: string): Handle {
    const handle = this.handles.get(name);
    if (!handle) throw new Error(`unknown process "${name}"`);
    return handle;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
