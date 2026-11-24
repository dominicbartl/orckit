import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Orckit } from '../orchestrator/orchestrator.js';
import type { ProcessState } from '../orchestrator/lifecycle.js';
import type { OrckitConfig } from '../config/schema.js';
import type { OutputLine } from '../process/output.js';
import { applyBuildEvent, type BuildTracker } from '../process/build-tracker.js';
import { getParser, type BuildEvent, type BuildStatus } from '../process/parsers.js';
import type { FirebaseLogEntry, LogLevel } from '../logs/firebase.js';
import { toJson } from '../logs/inspect-parse.js';
import type { ParsedLogTracker } from '../logs/tracker.js';

/**
 * Minimum surface the tool helpers need from an Orckit. The full `Orckit`
 * class naturally satisfies this; tests can pass a stub.
 */
export interface OrckitView {
  readonly config: OrckitConfig;
  inspect(name: string): {
    state: ProcessState;
    pid: number | null;
    startedAt: number | null;
    retries: number;
    url: string | null;
  };
  states(): Map<string, ProcessState>;
  output(name: string, n?: number): OutputLine[];
}

export interface StatusEntry {
  name: string;
  state: ProcessState;
  pid: number | null;
  startedAt: number | null;
  uptimeMs: number | null;
  retries: number;
  manualRetry: boolean;
  /** Where the process is reachable in a browser, or null. */
  url: string | null;
}

export interface ErrorEntry {
  name: string;
  state: ProcessState;
  lastError: string | null;
  recentStderr: { timestamp: number; text: string }[];
}

export interface LogsResult {
  name: string;
  state: ProcessState;
  lines: { timestamp: number; stream: 'stdout' | 'stderr'; text: string }[];
}

export interface BuildStatusEntry {
  name: string;
  state: ProcessState;
  /** False when the process's `type` has no build parser — `build` is always null then. */
  tracked: boolean;
  /** Current reduced build status, or null if no build event has been seen yet. */
  build: BuildStatus | null;
  /** Diagnostic lines from the latest failing build (empty unless `build.phase === 'failed'`). */
  diagnostics: string[];
}

export interface WaitForBuildResult extends BuildStatusEntry {
  /** True if the call blocked waiting for the build to settle (vs. returning a state it found). */
  waited: boolean;
  /** True if the timeout elapsed before the build settled — `build` is the last-seen state. */
  timedOut: boolean;
}

const STATE_ICON: Record<ProcessState, string> = {
  pending: '·',
  starting: '◐',
  ready: '○',
  running: '✓',
  finished: '✓',
  stopping: '◑',
  stopped: '·',
  failed: '✗',
};

export function buildStatus(
  orckit: OrckitView,
  publicUrl: (url: string) => string = (url) => url,
): StatusEntry[] {
  const now = Date.now();
  const entries: StatusEntry[] = [];
  for (const [name, processConfig] of Object.entries(orckit.config.processes)) {
    const info = orckit.inspect(name);
    entries.push({
      name,
      state: info.state,
      pid: info.pid,
      startedAt: info.startedAt,
      uptimeMs: info.startedAt != null ? now - info.startedAt : null,
      retries: info.retries,
      manualRetry: processConfig.manual_retry,
      url: info.url != null ? publicUrl(info.url) : null,
    });
  }
  return entries;
}

export function buildErrors(orckit: OrckitView, lastErrors: Map<string, string>): ErrorEntry[] {
  const entries: ErrorEntry[] = [];
  for (const [name, state] of orckit.states()) {
    if (state !== 'failed') continue;
    const stderr = orckit
      .output(name)
      .filter((l) => l.stream === 'stderr')
      .slice(-50)
      .map((l) => ({ timestamp: l.timestamp, text: l.text }));
    entries.push({
      name,
      state,
      lastError: lastErrors.get(name) ?? null,
      recentStderr: stderr,
    });
  }
  return entries;
}

export function buildLogs(
  orckit: OrckitView,
  args: { name: string; lines?: number; stream?: 'stdout' | 'stderr' | 'all' },
): LogsResult {
  const lines = clamp(args.lines ?? 100, 1, 1000);
  const stream = args.stream ?? 'all';
  // inspect() throws "unknown process" before we touch the buffer, giving a
  // clean error path for callers (handled in registerTools below).
  const info = orckit.inspect(args.name);
  let raw = orckit.output(args.name);
  if (stream !== 'all') raw = raw.filter((l) => l.stream === stream);
  return {
    name: args.name,
    state: info.state,
    lines: raw.slice(-lines).map((l) => ({
      timestamp: l.timestamp,
      stream: l.stream,
      text: l.text,
    })),
  };
}

export function formatStatusText(entries: StatusEntry[]): string {
  if (entries.length === 0) return 'no processes configured';
  const nameW = Math.max(...entries.map((e) => e.name.length));
  const stateW = Math.max(...entries.map((e) => e.state.length));
  const lines: string[] = [];
  const counts: Partial<Record<ProcessState, number>> = {};
  for (const e of entries) {
    counts[e.state] = (counts[e.state] ?? 0) + 1;
    const pidPart = e.pid != null ? `pid ${e.pid}` : '';
    const upPart = e.uptimeMs != null ? `up ${formatDuration(e.uptimeMs)}` : '';
    const retryPart = e.retries > 0 ? `retries ${e.retries}` : '';
    const tail = [pidPart, upPart, retryPart, e.url ?? ''].filter(Boolean).join('  ');
    lines.push(
      `  ${STATE_ICON[e.state]} ${e.name.padEnd(nameW)}  ${e.state.padEnd(stateW)}  ${tail}`,
    );
  }
  const summary = Object.entries(counts)
    .map(([s, n]) => `${n} ${s}`)
    .join(', ');
  return `${entries.length} processes (${summary}):\n${lines.join('\n')}`;
}

export function formatErrorsText(entries: ErrorEntry[]): string {
  if (entries.length === 0) return 'no errors — all processes are healthy';
  const blocks = entries.map((e) => {
    const head = `✗ ${e.name}  ${e.lastError ?? '(no error message captured)'}`;
    if (e.recentStderr.length === 0) {
      return `${head}\n  (no recent stderr)`;
    }
    const tail = e.recentStderr.map((l) => `  ! ${l.text}`).join('\n');
    return `${head}\n${tail}`;
  });
  return `${entries.length} failed process${entries.length === 1 ? '' : 'es'}:\n\n${blocks.join('\n\n')}`;
}

export function formatLogsText(result: LogsResult): string {
  const header = `${result.name} (${result.state}) — ${result.lines.length} line${result.lines.length === 1 ? '' : 's'}`;
  if (result.lines.length === 0) return `${header}\n  (no output captured)`;
  const body = result.lines
    .map((l) => `  ${l.stream === 'stderr' ? '!' : '|'} ${l.text}`)
    .join('\n');
  return `${header}\n${body}`;
}

// --- build status / wait ---------------------------------------------------

/** Default and ceiling for `wait_for_build`'s timeout. */
export const DEFAULT_WAIT_TIMEOUT_MS = 60_000;
export const MAX_WAIT_TIMEOUT_MS = 600_000;
const MIN_WAIT_TIMEOUT_MS = 1_000;
/**
 * Quiet period after the last terminal build event before we call a build
 * "settled". A failing watch build streams many `build:failed` diagnostics with
 * no clean terminal event, so we wait for them to stop rather than resolving on
 * the first one (which would capture only the first error).
 */
const BUILD_SETTLE_MS = 750;

function hasParser(orckit: OrckitView, name: string): boolean {
  const cfg = orckit.config.processes[name];
  return cfg ? getParser(cfg.type) !== null : false;
}

export function buildBuildStatus(
  orckit: OrckitView,
  tracker: BuildTracker,
  name: string,
): BuildStatusEntry {
  const info = orckit.inspect(name); // throws "unknown process" for a bad name
  const build = tracker.builds.get(name) ?? null;
  return {
    name,
    state: info.state,
    tracked: hasParser(orckit, name),
    build,
    diagnostics: build?.phase === 'failed' ? (tracker.buildErrors.get(name) ?? []) : [],
  };
}

/**
 * Build status for one process (when `name` is given) or for every process that
 * has a build parser / has emitted a build event.
 */
export function buildBuildStatuses(
  orckit: OrckitView,
  tracker: BuildTracker,
  name?: string,
): BuildStatusEntry[] {
  if (name != null) return [buildBuildStatus(orckit, tracker, name)];
  return Object.keys(orckit.config.processes)
    .filter((n) => hasParser(orckit, n) || tracker.builds.has(n))
    .map((n) => buildBuildStatus(orckit, tracker, n));
}

/** Minimal event surface `waitForBuild` subscribes to. The full Orckit satisfies it. */
export interface BuildEventSource {
  on(event: 'process:build', listener: (name: string, event: BuildEvent) => void): unknown;
  off(event: 'process:build', listener: (name: string, event: BuildEvent) => void): unknown;
}

/**
 * Block until the named process's build settles, then return its outcome.
 *
 * - Already settled (`done`/`failed`) or untracked (no build parser): returns
 *   immediately, `waited: false`.
 * - In progress: waits for a `build:complete`, or for a quiet period after the
 *   last `build:failed` diagnostic, whichever comes first.
 * - Timeout elapses first: returns the last-seen state with `timedOut: true`.
 *
 * Caveat (stale-success race): if the caller edits a file then calls this before
 * the watcher's `build:start` has been parsed, the previous cycle's `done` is
 * still current and is returned immediately. Poll `get_build_status` until the
 * phase flips to `building` first if that matters.
 */
export async function waitForBuild(
  orckit: OrckitView,
  source: BuildEventSource,
  tracker: BuildTracker,
  args: { name: string; timeoutMs?: number },
): Promise<WaitForBuildResult> {
  orckit.inspect(args.name); // throws "unknown process" for a bad name
  const tracked = hasParser(orckit, args.name);
  const timeoutMs = clamp(
    args.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
    MIN_WAIT_TIMEOUT_MS,
    MAX_WAIT_TIMEOUT_MS,
  );

  const finish = (
    waited: boolean,
    timedOut: boolean,
    build: BuildStatus | null,
    diagnostics: string[],
  ): WaitForBuildResult => ({
    name: args.name,
    state: orckit.inspect(args.name).state,
    tracked,
    build,
    diagnostics: build?.phase === 'failed' ? diagnostics : [],
    waited,
    timedOut,
  });

  const current = tracker.builds.get(args.name) ?? null;
  if (current && (current.phase === 'done' || current.phase === 'failed')) {
    return finish(false, false, current, tracker.buildErrors.get(args.name) ?? []);
  }
  if (!tracked && !current) {
    // No parser for this process type → no build:* events will ever arrive.
    return finish(false, false, null, []);
  }

  // In progress (or parser-backed but not yet emitted): block until it settles.
  // Re-derive status with the same accumulation rules the tracker uses, seeded
  // from the current cycle so diagnostics already collected survive.
  const localBuilds = new Map<string, BuildStatus>();
  const localErrors = new Map<string, string[]>();
  if (current) localBuilds.set(args.name, current);
  const seeded = tracker.buildErrors.get(args.name);
  if (seeded) localErrors.set(args.name, [...seeded]);

  return await new Promise<WaitForBuildResult>((resolve) => {
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(hardTimer);
      if (settleTimer) clearTimeout(settleTimer);
      source.off('process:build', onBuild);
    };
    const onBuild = (name: string, event: BuildEvent) => {
      if (name !== args.name) return;
      applyBuildEvent(name, event, localBuilds, localErrors);
      const status = localBuilds.get(name)!;
      if (status.phase === 'building') {
        // Still compiling — cancel any pending "settled" resolution.
        if (settleTimer) {
          clearTimeout(settleTimer);
          settleTimer = null;
        }
        return;
      }
      // done / failed: arm (or push out) the quiet timer. A stream of failed
      // diagnostics keeps re-arming it until the diagnostics stop.
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        cleanup();
        resolve(finish(true, false, status, localErrors.get(name) ?? []));
      }, BUILD_SETTLE_MS);
    };
    hardTimer = setTimeout(() => {
      cleanup();
      resolve(
        finish(true, true, localBuilds.get(args.name) ?? null, localErrors.get(args.name) ?? []),
      );
    }, timeoutMs);
    source.on('process:build', onBuild);
  });
}

function describeBuild(entry: BuildStatusEntry): string {
  if (!entry.tracked && !entry.build) return 'not a build process';
  const b = entry.build;
  if (!b) return 'no build yet';
  switch (b.phase) {
    case 'building':
      return b.percent != null ? `building ${b.percent}%` : 'building';
    case 'done':
      return b.success
        ? `done${b.durationMs != null ? ` in ${formatDuration(b.durationMs)}` : ''}${b.warnings ? `, ${b.warnings} warning(s)` : ''}`
        : `done with ${b.errors} error(s)`;
    case 'failed':
      return `failed${b.reason ? `: ${b.reason}` : ''}`;
  }
}

export function formatBuildStatusText(entries: BuildStatusEntry[]): string {
  if (entries.length === 0) return 'no build processes';
  const nameW = Math.max(...entries.map((e) => e.name.length));
  const lines = entries.map((e) => `  ${e.name.padEnd(nameW)}  ${describeBuild(e)}`);
  return `${entries.length} build process${entries.length === 1 ? '' : 'es'}:\n${lines.join('\n')}`;
}

export function formatWaitForBuildText(result: WaitForBuildResult): string {
  const head = `${result.name}: ${describeBuild(result)}`;
  const note = result.timedOut
    ? '  (timed out — build had not settled)'
    : result.waited
      ? ''
      : '  (no wait — already settled)';
  const head2 = note ? `${head}\n${note}` : head;
  if (result.build?.phase === 'failed' && result.diagnostics.length > 0) {
    const tail = result.diagnostics.map((d) => `  ! ${d}`).join('\n');
    return `${head2}\n${tail}`;
  }
  return head2;
}

// --- parsed function logs --------------------------------------------------

/** The slice of the parsed-log tracker `get_function_logs` reads. */
export type ParsedLogsView = Pick<ParsedLogTracker, 'names' | 'state' | 'entries' | 'generation'>;

export interface FunctionLogsArgs {
  /** Process with `parsed_logs`; optional when exactly one has it. */
  name?: string;
  /** `europe-west1-api` or just `api`. */
  function?: string;
  /** Case-insensitive substring of the handler (`OrdersController`, `.get`). */
  handler?: string;
  /** Minimum severity. */
  level?: LogLevel;
  /** An exact status (`404`) or a class (`4xx`). */
  status?: string;
  /** Case-insensitive substring of the message, stack or logged fields. */
  search?: string;
  include_executions?: boolean;
  include_system?: boolean;
  limit?: number;
}

export interface FunctionLogEntry {
  id: number;
  /** ISO timestamp. */
  time: string;
  kind: FirebaseLogEntry['kind'];
  function?: string;
  level?: LogLevel;
  handler?: string;
  /** NestJS logger context. */
  context?: string;
  message?: string;
  /** The logged object / structured fields as plain JSON. */
  fields?: unknown;
  stack?: string;
  durationMs?: number;
}

export interface FunctionLogsResult {
  name: string;
  /** Source state: idle / connecting / waiting / unavailable / connected. */
  source: string;
  detail?: string;
  generation: number;
  /** Entries kept for the process. */
  total: number;
  /** Entries matching the filters (before `limit`). */
  matched: number;
  entries: FunctionLogEntry[];
}

export const DEFAULT_FUNCTION_LOGS_LIMIT = 50;
export const MAX_FUNCTION_LOGS_LIMIT = 500;
const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** `europe-west1-api` → `api`. */
function shortFunctionName(fn: string): string {
  return fn.replace(/^[a-z]+(?:-[a-z]+)*\d+-/, '');
}

function entryFields(entry: FirebaseLogEntry): unknown {
  return entry.kind === 'log' && entry.value ? toJson(entry.value) : undefined;
}

function entryStatus(fields: unknown): number | undefined {
  if (!fields || typeof fields !== 'object') return undefined;
  const { status, statusCode } = fields as { status?: unknown; statusCode?: unknown };
  const value = typeof status === 'number' ? status : statusCode;
  return typeof value === 'number' ? value : undefined;
}

function statusMatches(status: number | undefined, wanted: string): boolean {
  if (status === undefined) return false;
  const cls = /^([1-5])xx$/i.exec(wanted.trim());
  return cls ? Math.floor(status / 100) === Number(cls[1]) : status === Number(wanted);
}

/**
 * Parsed Firebase emulator entries for a process, filtered for an agent:
 * request logs by function, handler, level, status and text. Executions and
 * emulator system lines are left out unless asked for — they are noise when
 * hunting a request's log — except that a `warn`/`error` level brings system
 * lines along (a codebase that failed to load is what such a query is after).
 */
export function buildFunctionLogs(
  view: ParsedLogsView,
  args: FunctionLogsArgs,
): FunctionLogsResult {
  const names = view.names();
  if (names.length === 0) throw new Error('no process has parsed_logs configured');
  const name = args.name ?? (names.length === 1 ? names[0]! : undefined);
  if (name === undefined) {
    throw new Error(`several processes have parsed_logs — pass name (one of: ${names.join(', ')})`);
  }
  const state = view.state(name);
  if (!state) {
    throw new Error(
      `process "${name}" has no parsed_logs (processes with it: ${names.join(', ')})`,
    );
  }

  const fn = args.function?.trim();
  const handler = args.handler?.trim().toLowerCase();
  const search = args.search?.trim().toLowerCase();
  const minLevel = args.level ? LEVEL_RANK[args.level] : undefined;
  // Asking for warnings or errors means asking what's wrong — and the
  // emulator's own load failures are among the answers.
  const includeSystem =
    args.include_system ?? (minLevel !== undefined && minLevel >= LEVEL_RANK.warn);
  const all = view.entries(name);

  const matched = all.filter((entry) => {
    if (entry.kind === 'execution' && !args.include_executions) return false;
    if (entry.kind === 'system' && !includeSystem) return false;
    if (fn && !(entry.fn === fn || (entry.fn && shortFunctionName(entry.fn) === fn))) return false;
    if (handler && !(entry.kind === 'log' && entry.handler?.toLowerCase().includes(handler))) {
      return false;
    }
    if (
      minLevel !== undefined &&
      (entry.kind === 'execution' || LEVEL_RANK[entry.level] < minLevel)
    ) {
      return false;
    }
    if (args.status && !statusMatches(entryStatus(entryFields(entry)), args.status)) return false;
    if (search) {
      const text =
        entry.kind === 'execution'
          ? entry.fn
          : [entry.message, entry.stack ?? '', JSON.stringify(entryFields(entry) ?? '')].join('\n');
      if (!text.toLowerCase().includes(search)) return false;
    }
    return true;
  });

  const limit = clamp(args.limit ?? DEFAULT_FUNCTION_LOGS_LIMIT, 1, MAX_FUNCTION_LOGS_LIMIT);
  return {
    name,
    source: state.state,
    ...('detail' in state && { detail: state.detail }),
    generation: view.generation(name),
    total: all.length,
    matched: matched.length,
    entries: matched.slice(-limit).map(toFunctionLogEntry),
  };
}

function toFunctionLogEntry(entry: FirebaseLogEntry): FunctionLogEntry {
  const base = {
    id: entry.id,
    time: new Date(entry.ts).toISOString(),
    kind: entry.kind,
    ...(entry.fn && { function: entry.fn }),
  };
  if (entry.kind === 'execution') return { ...base, durationMs: entry.durationMs };
  const fields = entryFields(entry);
  return {
    ...base,
    level: entry.level,
    ...(entry.kind === 'log' && entry.handler && { handler: entry.handler }),
    ...(entry.kind === 'log' && entry.context && { context: entry.context }),
    message: entry.message,
    ...(fields !== undefined && { fields }),
    ...(entry.stack && { stack: entry.stack }),
  };
}

/** Stack frames shown per entry in the text form; the JSON carries all of them. */
const TEXT_STACK_FRAMES = 4;

export function formatFunctionLogsText(result: FunctionLogsResult): string {
  const head =
    `${result.name} — parsed logs ${result.source}` +
    (result.detail ? ` (${result.detail})` : '') +
    ` · ${result.matched} of ${result.total} entries match` +
    (result.entries.length < result.matched ? `, showing the newest ${result.entries.length}` : '');
  if (result.entries.length === 0) return `${head}\n  (no matching entries)`;
  const lines = result.entries.map((e) => {
    const time = e.time.slice(11, 23);
    const fn = e.function ? shortFunctionName(e.function) : '-';
    if (e.kind === 'execution') return `  ${time} ƒ ${fn} ${e.durationMs}ms`;
    const level = (e.level ?? 'info').toUpperCase().padEnd(5);
    const context = e.context ? `[${e.context}] ` : '';
    const fields = e.fields !== undefined ? ` ${JSON.stringify(e.fields)}` : '';
    const stack = e.stack
      ? '\n' +
        e.stack
          .split('\n')
          .slice(0, TEXT_STACK_FRAMES)
          .map((l) => `      ${l.trim()}`)
          .join('\n')
      : '';
    // Continuation lines of a multi-line message (`Require stack:` …) are
    // indented like stack frames, so every entry stays one indented block.
    const message = (e.message ?? '').replace(/\n/g, '\n      ');
    return `  ${time} ${level} ${fn} ${context}${message}${fields}${stack}`;
  });
  return `${head}\n${lines.join('\n')}`;
}

const functionLogsInputShape = {
  name: z
    .string()
    .optional()
    .describe('Process with parsed_logs (orckit.yaml name). Optional when only one has it.'),
  function: z
    .string()
    .optional()
    .describe('Firebase function, full (europe-west1-api) or short (api) name.'),
  handler: z
    .string()
    .optional()
    .describe(
      'Case-insensitive substring of the Controller.method handler, e.g. "OrdersController".',
    ),
  level: z
    .enum(['debug', 'info', 'warn', 'error'])
    .optional()
    .describe('Minimum level: "warn" returns warnings and errors.'),
  status: z
    .string()
    .regex(/^(?:[1-5]xx|[1-5]\d\d)$/i)
    .optional()
    .describe('HTTP status of request logs: exact ("404") or a class ("5xx").'),
  search: z
    .string()
    .optional()
    .describe('Case-insensitive text to find in the message, stack or logged fields.'),
  include_executions: z
    .boolean()
    .optional()
    .describe(
      'Also return one entry per finished function execution with its duration (default false).',
    ),
  include_system: z
    .boolean()
    .optional()
    .describe(
      "Also return the emulator's own lines: start-up, load errors. Default: true when level " +
        'is warn or error, false otherwise.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_FUNCTION_LOGS_LIMIT)
    .optional()
    .describe(
      `Newest matching entries to return (default ${DEFAULT_FUNCTION_LOGS_LIMIT}, max ${MAX_FUNCTION_LOGS_LIMIT}).`,
    ),
};

const logsInputShape = {
  name: z.string().describe('Process name as defined in orckit.yaml.'),
  lines: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe('Number of most-recent lines to return (default 100, max 1000).'),
  stream: z
    .enum(['stdout', 'stderr', 'all'])
    .optional()
    .describe('Filter by stream (default "all").'),
};

const buildStatusInputShape = {
  name: z
    .string()
    .optional()
    .describe('Process name to query. Omit to get every build process at once.'),
};

const waitForBuildInputShape = {
  name: z.string().describe('Process name (as defined in orckit.yaml) whose build to wait for.'),
  timeout_ms: z
    .number()
    .int()
    .min(MIN_WAIT_TIMEOUT_MS)
    .max(MAX_WAIT_TIMEOUT_MS)
    .optional()
    .describe(
      `Max time to block in ms (default ${DEFAULT_WAIT_TIMEOUT_MS}, max ${MAX_WAIT_TIMEOUT_MS}).`,
    ),
};

export function registerTools(
  server: McpServer,
  orckit: Orckit,
  lastErrors: Map<string, string>,
  tracker: BuildTracker,
  publicUrl?: (url: string) => string,
  parsedLogs?: ParsedLogsView | null,
): void {
  // Only offered when some process has `parsed_logs`, so agents never see a
  // tool that can't answer.
  if (parsedLogs && parsedLogs.names().length > 0) {
    server.registerTool(
      'get_function_logs',
      {
        title: 'Firebase function logs',
        description:
          'Get structured logs from the Firebase emulators (processes with parsed_logs): what ' +
          "the user's Cloud Functions logged, one entry per console.log call or structured log " +
          'line, with the logged object as JSON fields, the function it ran in, the ' +
          'Controller.method handler when there is one, the level, and the stack of errors. ' +
          'Filter by function, handler, minimum level, HTTP status (404 / 5xx) or text instead ' +
          'of grepping raw output with get_logs. Function executions (with durations) are ' +
          'excluded unless include_executions is set; emulator system lines (start-up, load ' +
          'errors) unless include_system is set or level is warn/error.',
        inputSchema: functionLogsInputShape,
      },
      async (args) => {
        try {
          const result = buildFunctionLogs(parsedLogs, args);
          return toResult(formatFunctionLogsText(result), result);
        } catch (err) {
          return errorResult((err as Error).message);
        }
      },
    );
  }

  server.registerTool(
    'get_status',
    {
      title: 'Process status',
      description:
        'Get the current status of all processes managed by orckit for this project. ' +
        'Returns each process name, lifecycle state ' +
        '(pending/starting/ready/running/finished/stopping/stopped/failed), PID, uptime, ' +
        'retry count, whether the process is marked manual_retry, and its URL (where it is ' +
        'reachable in a browser, e.g. a dev server) when it has one. Use this to answer ' +
        '"is the build running", "what state is the API in" or "where is the frontend served".',
    },
    async () => {
      const entries = buildStatus(orckit, publicUrl);
      return toResult(formatStatusText(entries), { processes: entries });
    },
  );

  server.registerTool(
    'get_errors',
    {
      title: 'Failed processes',
      description:
        'List any failed processes with the failure error message and up to the last 50 ' +
        'lines of stderr. An empty list means everything is healthy. Use this first when ' +
        'diagnosing a broken build.',
    },
    async () => {
      const entries = buildErrors(orckit, lastErrors);
      return toResult(formatErrorsText(entries), { errors: entries });
    },
  );

  server.registerTool(
    'get_logs',
    {
      title: 'Process logs',
      description:
        'Get recent stdout/stderr from a named process. Use after get_errors to see more ' +
        'context around a failure, or to inspect output of a running process.',
      inputSchema: logsInputShape,
    },
    async (args) => {
      try {
        const result = buildLogs(orckit, args);
        return toResult(formatLogsText(result), result);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.registerTool(
    'get_build_status',
    {
      title: 'Build status',
      description:
        'Check whether a build/dev-server is currently compiling, succeeded, or failed — ' +
        "WITHOUT running the build yourself. orckit already runs the project's build/watch " +
        'processes, so prefer this over spawning your own `build`/`tsc`/`compile`. Returns ' +
        'per-process build phase (building/done/failed), error/warning counts, duration, and ' +
        'failure diagnostics. Omit `name` for all build processes. Use wait_for_build to block ' +
        'until an in-progress build settles.',
      inputSchema: buildStatusInputShape,
    },
    async (args) => {
      try {
        const entries = buildBuildStatuses(orckit, tracker, args.name);
        return toResult(formatBuildStatusText(entries), { builds: entries });
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );

  server.registerTool(
    'wait_for_build',
    {
      title: 'Wait for build',
      description:
        "Block until the named process's build settles, then return success/failure with " +
        "diagnostics. Use this INSTEAD of running your own build to verify a change: orckit's " +
        'watch process is already rebuilding, so wait for its result rather than starting a ' +
        'duplicate compile. Returns immediately if the build is already settled or the process ' +
        'has no build parser. On failure the result includes the build diagnostics so you can ' +
        'act without a second call.',
      inputSchema: waitForBuildInputShape,
    },
    async (args) => {
      try {
        const result = await waitForBuild(orckit, orckit, tracker, {
          name: args.name,
          timeoutMs: args.timeout_ms,
        });
        return toResult(formatWaitForBuildText(result), result);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}

function toResult(text: string, json: unknown): CallToolResult {
  return {
    content: [
      { type: 'text', text },
      { type: 'text', text: '```json\n' + JSON.stringify(json, null, 2) + '\n```' },
    ],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return `${m}m${remS}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}
