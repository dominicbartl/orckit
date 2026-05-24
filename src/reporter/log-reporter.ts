import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Orckit } from '../orchestrator/orchestrator.js';
import type { OutputLine } from '../process/output.js';

export interface LogReporterOptions {
  /** Directory for log files (relative to cwd or absolute). */
  dir: string;
  /**
   * Base directory used to resolve a relative `dir`. Defaults to `process.cwd()`.
   * Exposed mainly for tests.
   */
  cwd?: string;
}

export interface LogReporterHandle {
  /** Absolute path of the log directory in use. */
  readonly dir: string;
  /** Absolute path of the file for a given process. */
  fileFor(name: string): string;
  /** Detach event listeners and close all open streams. */
  dispose(): Promise<void>;
}

const FILENAME_UNSAFE = /[^A-Za-z0-9._-]+/g;

export function attachLogReporter(orckit: Orckit, opts: LogReporterOptions): LogReporterHandle {
  const dir = resolve(opts.cwd ?? process.cwd(), opts.dir);
  mkdirSync(dir, { recursive: true });

  const streams = new Map<string, WriteStream>();
  const files = new Map<string, string>();

  const fileFor = (name: string): string => {
    const cached = files.get(name);
    if (cached) return cached;
    const path = join(dir, `${sanitize(name)}.log`);
    files.set(name, path);
    return path;
  };

  const streamFor = (name: string): WriteStream => {
    const existing = streams.get(name);
    if (existing) return existing;
    const s = createWriteStream(fileFor(name), { flags: 'a' });
    streams.set(name, s);
    return s;
  };

  const onStarting = (name: string) => {
    const header = sessionHeader(name);
    streamFor(name).write(header);
  };

  const onLine = (name: string, line: OutputLine) => {
    const stream = streams.get(name);
    if (!stream) return;
    const prefix = line.stream === 'stderr' ? '! ' : '  ';
    stream.write(prefix + line.text + '\n');
  };

  const onStopped = (name: string) => writeFooter(name, 'stopped');
  const onFinished = (name: string) => writeFooter(name, 'finished');
  const onFailed = (name: string, err?: Error) => {
    const detail = err ? `: ${err.message}` : '';
    writeFooter(name, `failed${detail}`);
  };

  const writeFooter = (name: string, status: string) => {
    const stream = streams.get(name);
    if (!stream) return;
    stream.write(`-- ${timestamp()} ${status}\n`);
  };

  orckit.on('process:starting', onStarting);
  orckit.on('process:line', onLine);
  orckit.on('process:stopped', onStopped);
  orckit.on('process:finished', onFinished);
  orckit.on('process:failed', onFailed);

  return {
    dir,
    fileFor,
    async dispose() {
      orckit.off('process:starting', onStarting);
      orckit.off('process:line', onLine);
      orckit.off('process:stopped', onStopped);
      orckit.off('process:finished', onFinished);
      orckit.off('process:failed', onFailed);
      await Promise.all([...streams.values()].map(closeStream));
      streams.clear();
    },
  };
}

function sessionHeader(name: string): string {
  const ts = timestamp();
  const banner = '='.repeat(72);
  return `\n${banner}\n== ${name} started ${ts} (pid ${process.pid})\n${banner}\n`;
}

function timestamp(): string {
  return new Date().toISOString();
}

function sanitize(name: string): string {
  const cleaned = name.replace(FILENAME_UNSAFE, '_');
  return cleaned.length > 0 ? cleaned : '_';
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolveFn) => {
    stream.end(() => resolveFn());
  });
}
