import { EventEmitter } from 'node:events';
import { execa, type ResultPromise } from 'execa';
import treeKill from 'tree-kill';
import type { ProcessConfig } from '../config/schema.js';
import { mergeEnv } from '../util/env.js';
import { bindLineStream } from '../util/line-stream.js';
import { killPortHolders } from '../util/port.js';

export type Stream = 'stdout' | 'stderr';

export interface RunnerEvents {
  line: [text: string, stream: Stream];
  exit: [code: number | null, signal: NodeJS.Signals | null];
  error: [error: Error];
  /**
   * A termination signal was sent to the process tree. Emitted with `SIGTERM`
   * when graceful stop begins and again with `SIGKILL` if the grace window
   * expires and the process has to be force-killed. Lets a reporter surface
   * "force killing X" rather than the kill happening silently.
   */
  kill: [signal: NodeJS.Signals];
  /**
   * An orphaned process holding one of the configured `ports` was force-killed
   * after the normal stop path completed (see `kill_orphan_ports`). Emitted once
   * per freed (port, pid) so a reporter can surface the resource-based cleanup.
   */
  port_freed: [port: number, pid: number];
}

const DEFAULT_GRACE_MS = 10_000;

/**
 * How long to wait after SIGKILL for execa's promise to settle before giving up
 * and synthesizing the exit. SIGKILL is instantaneous for any process we can
 * reach, so a clean settle normally lands in well under a second; this only ever
 * elapses when an escaped child is holding our stdio pipes open.
 */
const SIGKILL_REAP_MS = 2_000;

export class Runner extends EventEmitter<RunnerEvents> {
  private process: ResultPromise | null = null;
  private exited = false;
  private _exitCode: number | null = null;
  private _exitSignal: NodeJS.Signals | null = null;

  constructor(
    public readonly name: string,
    public readonly config: ProcessConfig,
  ) {
    super();
  }

  get pid(): number | undefined {
    return this.process?.pid;
  }

  get running(): boolean {
    return this.process !== null && !this.exited;
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  get exitSignal(): NodeJS.Signals | null {
    return this._exitSignal;
  }

  start(): void {
    if (this.process) {
      throw new Error(`runner "${this.name}" already started`);
    }
    this.exited = false;
    this._exitCode = null;
    this._exitSignal = null;

    this.process = execa('bash', ['-c', this.config.command], {
      cwd: this.config.cwd ?? process.cwd(),
      env: mergeEnv(this.config.env),
      reject: false,
      buffer: false,
      stdin: 'ignore',
      // Put the child (and every descendant it spawns) into a fresh process
      // group led by the child's pid. This lets `stop()` signal the WHOLE group
      // at once via `kill(-pgid)` — the only reliable way to reap deep,
      // fork-heavy trees (pnpm → node → firebase → Java emulators, `ng serve` →
      // esbuild workers) whose grandchildren reparent to init before a
      // ppid-walking tree-kill can reach them. As a bonus, a detached child no
      // longer receives the terminal's Ctrl-C SIGINT directly, so the
      // orchestrator is the single authority for tearing it down.
      detached: true,
    });

    this.process.stdout?.setEncoding('utf-8');
    this.process.stderr?.setEncoding('utf-8');

    bindLineStream(this.process.stdout, (line) => this.emit('line', line, 'stdout'));
    bindLineStream(this.process.stderr, (line) => this.emit('line', line, 'stderr'));

    this.process.on('error', (err: Error) => {
      this.emit('error', err);
    });

    this.process.then(
      (result) => {
        // `forceExit()` may have already declared this process gone (see stop());
        // if so, don't re-emit when execa's promise eventually settles.
        if (this.exited) return;
        this.exited = true;
        this._exitCode = result.exitCode ?? null;
        this._exitSignal = (result.signal as NodeJS.Signals | null | undefined) ?? null;
        this.emit('exit', this._exitCode, this._exitSignal);
      },
      (err: Error) => {
        if (this.exited) return;
        this.exited = true;
        this.emit('error', err);
        this.emit('exit', null, null);
      },
    );
  }

  async stop(graceMs = DEFAULT_GRACE_MS): Promise<void> {
    if (!this.process || this.exited) {
      this.process = null;
      return;
    }
    const pid = this.process.pid;
    if (!pid) {
      this.process = null;
      return;
    }
    const finished = this.awaitExit();
    if (this.config.stop_command) {
      // Custom stop verb (e.g. `docker stop <name>`) — fire and forget; we only
      // care that it triggers a graceful exit of the main process. Any stderr
      // is surfaced through the runner's normal line stream so the user sees
      // it in the failure-tail dump on errors.
      this.runStopCommand(this.config.stop_command);
    } else {
      this.emit('kill', 'SIGTERM');
      killTree(pid, 'SIGTERM');
    }
    const winner = await Promise.race([
      finished.then(() => 'exit' as const),
      delay(graceMs).then(() => 'timeout' as const),
    ]);
    if (winner === 'timeout' && !this.exited) {
      this.emit('kill', 'SIGKILL');
      killTree(pid, 'SIGKILL');
      // SIGKILL is unblockable, so anything we can reach is now dead — but execa
      // only settles its promise once every stdout/stderr pipe has hit EOF. A
      // child that escaped into its own process group (e.g. a `set -m`
      // background job) can survive our group/tree kill AND keep the inherited
      // pipe open, so `finished` would never resolve and shutdown would hang
      // forever. Wait a short bounded window for a clean settle, then force it.
      const settled = await Promise.race([
        finished.then(() => true),
        delay(SIGKILL_REAP_MS).then(() => false),
      ]);
      if (!settled && !this.exited) this.forceExit();
    }
    this.process = null;
    await this.sweepOrphanPorts();
  }

  /**
   * Resource-based teardown backstop, run after the process tree is reaped. When
   * `kill_orphan_ports` is set, force-kill anything still bound to one of the
   * process's declared ports — the escaped grandchild (e.g. a Firebase emulator
   * JVM) that survived the group/tree kill and would otherwise keep its port
   * bound for the next boot. No-op unless opted in and ports are known.
   */
  private async sweepOrphanPorts(): Promise<void> {
    if (!this.config.kill_orphan_ports) return;
    const ports = this.declaredPorts();
    if (ports.length === 0) return;
    const freed = await killPortHolders(ports);
    for (const { port, pid } of freed) this.emit('port_freed', port, pid);
  }

  /**
   * Ports the sweep should reclaim: the explicit `ports` list plus the `tcp`
   * ready-check port (the one most likely to be held), de-duplicated.
   */
  private declaredPorts(): number[] {
    const ports = new Set(this.config.ports ?? []);
    if (this.config.ready?.type === 'tcp') ports.add(this.config.ready.port);
    return [...ports];
  }

  /**
   * Last resort when a process tree won't release our stdio pipes after SIGKILL
   * (see stop()). Tears down our readers so the dangling execa promise can't
   * keep the event loop alive, and synthesizes the `exit` event so listeners
   * waiting on a clean stop (the orchestrator's state machine) aren't stranded.
   */
  private forceExit(): void {
    this.exited = true;
    this._exitSignal = 'SIGKILL';
    this.process?.stdout?.destroy();
    this.process?.stderr?.destroy();
    this.emit('exit', this._exitCode, this._exitSignal);
  }

  private runStopCommand(command: string): void {
    const sub = execa('bash', ['-c', command], {
      cwd: this.config.cwd ?? process.cwd(),
      env: mergeEnv(this.config.env),
      reject: false,
      buffer: false,
      stdin: 'ignore',
    });
    sub.stdout?.setEncoding('utf-8');
    sub.stderr?.setEncoding('utf-8');
    bindLineStream(sub.stdout, (line) => this.emit('line', line, 'stdout'));
    bindLineStream(sub.stderr, (line) => this.emit('line', line, 'stderr'));
    // Swallow errors — if the stop command itself fails, the grace timeout
    // will fall through to SIGKILL anyway.
    sub.catch(() => {});
  }

  private awaitExit(): Promise<void> {
    if (this.exited) return Promise.resolve();
    return new Promise((resolve) => this.once('exit', () => resolve()));
  }
}

function killTree(pid: number, signal: NodeJS.Signals): void {
  // Primary: signal the whole process group. The child was spawned `detached`,
  // so its pid is also its process-group id; `kill(-pid)` hits every process in
  // that group atomically, including descendants that reparented away from the
  // child. This is what actually frees held ports (firestore, auth, ng serve)
  // on shutdown.
  try {
    process.kill(-pid, signal);
  } catch {
    // Group already gone (ESRCH) or not permitted — fall through to tree-kill.
  }
  // Fallback: catch anything that escaped the group by starting its own session
  // (rare, but some tools call setsid). Best-effort; ignore errors.
  treeKill(pid, signal, () => {});
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
