import { EventEmitter } from 'node:events';
import { execa, type ResultPromise } from 'execa';
import treeKill from 'tree-kill';
import type { ProcessConfig } from '../config/schema.js';
import { mergeEnv } from '../util/env.js';

export type Stream = 'stdout' | 'stderr';

export interface RunnerEvents {
  line: [text: string, stream: Stream];
  exit: [code: number | null, signal: NodeJS.Signals | null];
  error: [error: Error];
}

const DEFAULT_GRACE_MS = 10_000;

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
        this.exited = true;
        this._exitCode = result.exitCode ?? null;
        this._exitSignal = (result.signal as NodeJS.Signals | null | undefined) ?? null;
        this.emit('exit', this._exitCode, this._exitSignal);
      },
      (err: Error) => {
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
    killTree(pid, 'SIGTERM');
    const winner = await Promise.race([
      finished.then(() => 'exit' as const),
      delay(graceMs).then(() => 'timeout' as const),
    ]);
    if (winner === 'timeout' && !this.exited) {
      killTree(pid, 'SIGKILL');
      await finished;
    }
    this.process = null;
  }

  private awaitExit(): Promise<void> {
    if (this.exited) return Promise.resolve();
    return new Promise((resolve) => this.once('exit', () => resolve()));
  }
}

function bindLineStream(
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void,
): void {
  if (!stream) return;
  let leftover = '';
  stream.on('data', (chunk: string | Buffer) => {
    leftover += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    let newlineIdx: number;
    while ((newlineIdx = leftover.indexOf('\n')) >= 0) {
      const line = leftover.slice(0, newlineIdx).replace(/\r$/, '');
      leftover = leftover.slice(newlineIdx + 1);
      onLine(line);
    }
  });
  stream.on('end', () => {
    if (leftover.length > 0) {
      onLine(leftover);
      leftover = '';
    }
  });
}

function killTree(pid: number, signal: NodeJS.Signals): void {
  treeKill(pid, signal, () => {
    // best-effort; ignore errors (process may already be gone)
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
