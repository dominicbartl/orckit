/**
 * Mirror of orckit's `ProcessState`. Kept as a local copy so the frontend
 * can build without depending on the cli package — the values are part of
 * the public event API so drift would surface as a type error in the
 * server-side serializer, not as a silent skew at runtime.
 */
export type ProcessState =
  | 'pending'
  | 'starting'
  | 'ready'
  | 'running'
  | 'finished'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type Stream = 'stdout' | 'stderr';

/**
 * Mirror of orckit's `BuildStatus` (src/process/parsers.ts). The reduced,
 * current state of a process's most recent build, streamed over SSE for
 * processes whose `type` has a build parser (webpack, angular, …).
 */
export type BuildStatus =
  | { phase: 'building'; percent?: number }
  | { phase: 'done'; success: boolean; errors: number; warnings: number; durationMs?: number }
  | { phase: 'failed'; reason?: string };

export interface OutputLine {
  text: string;
  stream: Stream;
  timestamp: number;
  highlight?: string;
}

export interface ProcessSnapshot {
  name: string;
  state: ProcessState;
  type: string;
  command: string;
  category: string;
  depends_on: string[];
  pid: number | null;
  startedAt: number | null;
  retries: number;
  optional: boolean;
  /**
   * Absolute working directory the process runs in. Relative file references in
   * its output are resolved against this before building IDE deep links.
   */
  cwd: string;
  /**
   * The process's root URL — where it's reachable in a browser (a dev server,
   * the Firebase Emulator UI). Static from config or detected from output;
   * updated live via the `url` SSE event. Null when it has none.
   */
  url: string | null;
  lastError?: string;
  build?: BuildStatus;
  /**
   * Diagnostic lines from the latest failing build. Seeded from the snapshot
   * and accumulated client-side as build:failed deltas arrive (each carries one
   * error line as `reason`); cleared on a rebuild or a successful completion.
   */
  buildErrors?: string[];
  /** Present when the process has `parsed_logs`; entries come from `/api/logs/:name`. */
  parsedLogs?: ParsedLogsSnapshot;
}

/**
 * Mirror of orckit's `IdeLink` (src/web/ide.ts). Present when a JetBrains
 * project was detected; its mere presence enables linkifying file references.
 * Clicking POSTs to orckit's `/api/open`, which decides server-side whether to
 * open the file in the IDE (under `root`) or the OS default app (outside it).
 * The fields aren't needed by the frontend today — they mirror the wire format.
 */
export interface IdeLink {
  /** The IDE's command-line launcher (e.g. `webstorm`). */
  command: string;
  /** Absolute project root (the directory containing `.idea`). */
  root: string;
}

export interface OrckitSnapshot {
  project: string;
  processes: ProcessSnapshot[];
  ide: IdeLink | null;
}

/* -------------------------------------------------------------------------
 * Parsed logs — mirrors of src/logs/inspect-parse.ts, src/logs/firebase.ts and
 * src/logs/tracker.ts. Kept as local copies like the types above.
 * ----------------------------------------------------------------------- */

export interface LogProp {
  key: string;
  value: LogValue;
}

interface LogContainerBase {
  /** `Foo`, `Map(2)`, `[Object: null prototype]`, `Error: boom\n    at …`. */
  tag?: string;
  /** Printed as `<ref *N>` — the target of a later `[Circular *N]`. */
  ref?: number;
  /** From a trailing `... N more items`. */
  more?: number;
}

export type LogValue =
  | { kind: 'string'; value: string }
  /** As printed, so `NaN`, `-0` and bigints (`10n`) survive. */
  | { kind: 'number'; text: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'undefined' }
  | { kind: 'date'; text: string }
  /** `[Function: f]`, `[Circular *1]`, `[Object]`, `Symbol(x)`, `/re/g`, `<Buffer …>`, … */
  | { kind: 'special'; text: string }
  | (LogContainerBase & { kind: 'object'; props: LogProp[]; items?: LogValue[] })
  | (LogContainerBase & { kind: 'array'; items: LogValue[]; props?: LogProp[] })
  | (LogContainerBase & { kind: 'map'; pairs: { key: LogValue; value: LogValue }[] });

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface EntryBase {
  /** Increasing in timeline order within one generation. */
  id: number;
  /** Epoch ms of the entry's first line. */
  ts: number;
  /** Full Firebase function name (`europe-west1-api`). */
  fn?: string;
}

export interface ExecutionEntry extends EntryBase {
  kind: 'execution';
  fn: string;
  durationMs: number;
}

export interface UserLogEntry extends EntryBase {
  kind: 'log';
  level: LogLevel;
  message: string;
  value?: LogValue;
  stack?: string;
  /** `Controller.method`. */
  handler?: string;
  /** NestJS logger context. */
  context?: string;
  /** NestJS logger pid (the worker). */
  pid?: number;
  lineCount: number;
}

export interface SystemEntry extends EntryBase {
  kind: 'system';
  level: LogLevel;
  message: string;
  stack?: string;
  /** `functions`, `emulators`, … */
  emulator?: string;
}

export type ParsedLogEntry = ExecutionEntry | UserLogEntry | SystemEntry;

/** Where a process's log source stands. `idle`: the process isn't running. */
export type ParsedLogState = { source: 'firebase' } & (
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'connected'; url: string }
  | { state: 'waiting'; detail: string }
  | { state: 'unavailable'; detail: string }
);

export interface ParsedLogsSnapshot {
  state: ParsedLogState;
  /** Connection the entries belong to; entry ids restart with each one. */
  generation: number;
  count: number;
}
