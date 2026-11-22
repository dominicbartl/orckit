/**
 * Turns the Firebase logging emulator's WebSocket bundles into viewer entries:
 * one row per finished function execution, user log lines merged back into the
 * `console.log` call that printed them (with the trailing object parsed into a
 * `LogValue` tree), and emulator system lines.
 *
 * The shapes this relies on were recorded from firebase-tools 15.32 — see
 * tests/fixtures/firebase-logging/README.md. Two of them drive the design:
 *
 * - **One bundle per stdout line.** A `console.log(obj)` arrives as N bundles,
 *   so lines are reassembled here: a line continues its function's open entry
 *   while brackets are open or the line is indented, within `MERGE_GAP_MS`.
 * - **No execution id.** `Finished` lines can't be paired with their
 *   `Beginning`, and logs can arrive before or after their `Finished`. So user
 *   entries are never attributed to an execution; the timeline stays flat.
 */

import { fromJson, parseLogText, type LogProp, type LogValue } from './inspect-parse.js';
import { stripAnsi } from '../process/parsers.js';

/** One message from the logging emulator's WebSocket. */
export interface FirebaseLogBundle {
  level: string;
  timestamp: number;
  message: string;
  data: {
    metadata?: {
      emulator?: { name?: string };
      function?: { name?: string };
      message?: string;
    };
    /** Present on user log lines: `JSON.parse(line)` when it parses, else the line. */
    user?: unknown;
  };
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface EntryBase {
  /** Increasing in timeline order; assigned when the entry starts. */
  id: number;
  /** Epoch ms of the entry's first bundle. */
  ts: number;
  /** Full Firebase function name (`europe-west1-api`), when the line had one. */
  fn?: string;
}

/** A function execution, from its `Finished "<fn>" in <ms>ms` line. */
export interface ExecutionEntry extends EntryBase {
  kind: 'execution';
  fn: string;
  durationMs: number;
}

/** What the user's code logged — one `console.log` call or structured log line. */
export interface UserLogEntry extends EntryBase {
  kind: 'log';
  level: LogLevel;
  /** Text before the value, without stack frames. Empty for a bare logged object. */
  message: string;
  /** The logged object (`console.log('msg', obj)`), or a structured line's fields. */
  value?: LogValue;
  /** Stack frames following an error message, joined with `\n`. */
  stack?: string;
  /** `Controller.method` — from `controller`/`handler` fields or a leading `Foo.bar` token. */
  handler?: string;
  /** NestJS logger context (`[AllExceptionsFilter]`). */
  context?: string;
  /** NestJS logger pid — the worker process, so it identifies the execution. */
  pid?: number;
  /** Stdout lines merged into this entry. */
  lineCount: number;
}

/** The emulator's own output: start-up, warnings, load errors. */
export interface SystemEntry extends EntryBase {
  kind: 'system';
  level: LogLevel;
  message: string;
  stack?: string;
  /** `functions`, `emulators`, … — from metadata or the `i  label:` prefix. */
  emulator?: string;
}

export type FirebaseLogEntry = ExecutionEntry | UserLogEntry | SystemEntry;

/**
 * Lines of one function more than this far apart never merge. Recorded
 * multi-line dumps arrive within 1–2 ms; distinct calls are usually further.
 */
export const MERGE_GAP_MS = 50;

export interface FirebaseLogAssembler {
  /** Feed one bundle; returns the entries that became final, in timeline order. */
  push(bundle: FirebaseLogBundle): FirebaseLogEntry[];
  /**
   * Close every entry still collecting lines and return what was held back.
   * Call it once the stream has been quiet for `MERGE_GAP_MS` — otherwise the
   * last log line waits for the next bundle to arrive.
   */
  flush(): FirebaseLogEntry[];
  /** Executions currently running per function (`Beginning` minus `Finished`). */
  inFlight(): ReadonlyMap<string, number>;
}

/** A user entry still collecting lines. */
interface OpenEntry {
  id: number;
  ts: number;
  fn: string | undefined;
  lines: string[];
  lastTs: number;
  /** Unclosed `{`/`[` count across the lines so far. */
  depth: number;
  closed: boolean;
}

type Slot = { open: OpenEntry } | { done: FirebaseLogEntry };

const BEGINNING_RE = /^Beginning execution of "([^"]+)"/;
const FINISHED_RE = /^Finished "([^"]+)" in ([\d.]+)ms/;
/** `i  functions: …`, `✔  functions: …`, `⚠  functions[x]: …`, `!!  …`. */
const CLI_PREFIX_RE = /^(?:i|✔|⚠|!!|✘|>)\s+([\w.-]+(?:\[[^\]]*\])?):\s+/;
/** `[Nest] 94766  - 10/21/2026, 3:34:06 PM    WARN [Context] message` (level right-aligned to 7). */
const NEST_RE =
  /^\[Nest\] (\d+)\s+-\s+.*?\s(LOG|ERROR|WARN|DEBUG|VERBOSE|FATAL) \[([^\]]+)\] ?([\s\S]*)$/;
const STACK_FRAME_RE = /^\s+at /;
const ERROR_HEAD_RE = /^(?:[A-Za-z_$][\w$]*)?(?:Error|Exception)\b/;
const HANDLER_RE = /^([A-Z][\w$]*\.[A-Za-z_$][\w$]*)\b/;
const QUOTED_RE = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;

export function createFirebaseLogAssembler(): FirebaseLogAssembler {
  let nextId = 0;
  /** Entries in timeline order; finished ones wait here behind open ones. */
  const queue: Slot[] = [];
  /** The open entry per function (`''` for lines without one). */
  const openByFn = new Map<string, OpenEntry>();
  const running = new Map<string, number>();

  const close = (entry: OpenEntry) => {
    entry.closed = true;
    if (openByFn.get(entry.fn ?? '') === entry) openByFn.delete(entry.fn ?? '');
  };

  /** Pop every finished entry off the front of the queue. */
  const drain = (): FirebaseLogEntry[] => {
    const out: FirebaseLogEntry[] = [];
    while (queue.length > 0) {
      const head = queue[0]!;
      if ('done' in head) out.push(head.done);
      else if (head.open.closed) out.push(finishUserEntry(head.open));
      else break;
      queue.shift();
    }
    return out;
  };

  const push = (bundle: FirebaseLogBundle): FirebaseLogEntry[] => {
    const fn = bundle.data.metadata?.function?.name || undefined;
    const ts = bundle.timestamp;

    // Any entry idle past the gap is done, whichever function it belongs to.
    for (const entry of openByFn.values()) {
      if (ts - entry.lastTs > MERGE_GAP_MS) close(entry);
    }

    if (bundle.data.user !== undefined) {
      pushUserLine(bundle, fn, ts);
      return drain();
    }

    const open = openByFn.get(fn ?? '');
    // A system line of the same function ends a finished call; mid-object it
    // is the stream interleaving a split chunk, so leave the entry open.
    if (open && open.depth === 0) close(open);

    const begin = BEGINNING_RE.exec(bundle.message);
    if (begin) {
      running.set(begin[1]!, (running.get(begin[1]!) ?? 0) + 1);
      return drain();
    }
    const finished = FINISHED_RE.exec(bundle.message);
    if (finished) {
      const name = finished[1]!;
      const n = (running.get(name) ?? 0) - 1;
      if (n > 0) running.set(name, n);
      else running.delete(name);
      queue.push({
        done: { kind: 'execution', id: nextId++, ts, fn: name, durationMs: Number(finished[2]) },
      });
      return drain();
    }
    queue.push({ done: systemEntry(nextId++, bundle, fn) });
    return drain();
  };

  const pushUserLine = (bundle: FirebaseLogBundle, fn: string | undefined, ts: number) => {
    const user = bundle.data.user;
    // `message` is `>  ` + the line with ANSI already stripped; `data.user` is
    // unreliable as text (a `  2` line of an array dump parses to the number 2).
    const text = stripAnsi(bundle.message).replace(/^>  ?/, '');
    const key = fn ?? '';
    const open = openByFn.get(key);

    if (open && continues(open, text)) {
      open.lines.push(text);
      open.lastTs = ts;
      open.depth = nextDepth(open.depth, text);
      // A closing bracket in column 0 ends a top-level inspect block.
      if (open.depth === 0 && /^[}\]]/.test(text)) close(open);
      return;
    }
    if (open) close(open);

    if (isStructured(user, text)) {
      queue.push({ done: structuredEntry(nextId++, ts, fn, user as Record<string, unknown>) });
      return;
    }
    const entry: OpenEntry = {
      id: nextId++,
      ts,
      fn,
      lines: [text],
      lastTs: ts,
      depth: nextDepth(0, text),
      closed: false,
    };
    openByFn.set(key, entry);
    queue.push({ open: entry });
  };

  return {
    push,
    flush() {
      for (const entry of openByFn.values()) close(entry);
      return drain();
    },
    inFlight: () => running,
  };
}

/**
 * Whether a line continues the open entry. Same function and the gap are
 * already settled by the caller; what's left is the shape of the line.
 */
function continues(entry: OpenEntry, text: string): boolean {
  return entry.depth > 0 || /^[ \t]/.test(text) || /^[}\]]/.test(text);
}

/**
 * Bracket depth after `text`. Inside an open block every bracket counts;
 * outside one, only a line ending in `{`/`[` opens a block — that's how
 * util.inspect starts a multi-line dump. A stray bracket in prose
 * (`Unexpected token { in JSON`) must not, or every later line of the function
 * would merge into this entry until the next quiet gap.
 */
function nextDepth(depth: number, text: string): number {
  if (depth === 0 && !/[{[]\s*$/.test(text)) return 0;
  return Math.max(0, depth + bracketDelta(text));
}

/** Net `{`/`[` opened by a line, ignoring brackets inside quoted strings. */
function bracketDelta(text: string): number {
  let delta = 0;
  for (const ch of text.replace(QUOTED_RE, '')) {
    if (ch === '{' || ch === '[') delta++;
    else if (ch === '}' || ch === ']') delta--;
  }
  return delta;
}

/** A firebase-functions `logger` line: one JSON object (not a stray parsed fragment). */
function isStructured(user: unknown, text: string): boolean {
  return (
    user !== null &&
    typeof user === 'object' &&
    !Array.isArray(user) &&
    text.trimStart().startsWith('{')
  );
}

function finishUserEntry(open: OpenEntry): UserLogEntry {
  const text = open.lines.join('\n');
  const base = {
    kind: 'log' as const,
    id: open.id,
    ts: open.ts,
    ...(open.fn !== undefined && { fn: open.fn }),
    lineCount: open.lines.length,
  };

  const nest = NEST_RE.exec(text);
  if (nest) {
    const { message, stack } = splitStack(nest[4]!.trimEnd());
    return {
      ...base,
      level: nestLevel(nest[2]!),
      message,
      ...(stack && { stack }),
      context: nest[3]!,
      pid: Number(nest[1]),
    };
  }

  const parsed = parseLogText(text);
  const { message, stack } = splitStack(parsed.message);
  const handler = findHandler(message, parsed.value ?? undefined);
  const isError = stack !== undefined || ERROR_HEAD_RE.test(message);
  return {
    ...base,
    level: isError ? 'error' : 'info',
    message,
    ...(parsed.value && { value: parsed.value }),
    ...(stack && { stack }),
    ...(handler && { handler }),
  };
}

const SEVERITY: Record<string, LogLevel> = {
  DEBUG: 'debug',
  INFO: 'info',
  NOTICE: 'info',
  WARNING: 'warn',
  ERROR: 'error',
  CRITICAL: 'error',
  ALERT: 'error',
  EMERGENCY: 'error',
};

/** A firebase-functions `logger` line: `{ ...fields, severity, message }`. */
function structuredEntry(
  id: number,
  ts: number,
  fn: string | undefined,
  user: Record<string, unknown>,
): UserLogEntry {
  const { severity, message: rawMessage, ...fields } = user;
  const { message, stack } = splitStack(typeof rawMessage === 'string' ? rawMessage : '');
  const value = Object.keys(fields).length > 0 ? fromJson(fields) : undefined;
  const handler = findHandler(message, value);
  return {
    kind: 'log',
    id,
    ts,
    ...(fn !== undefined && { fn }),
    level: (typeof severity === 'string' && SEVERITY[severity.toUpperCase()]) || 'info',
    message,
    ...(value && { value }),
    ...(stack && { stack }),
    ...(handler && { handler }),
    lineCount: 1,
  };
}

function systemEntry(id: number, bundle: FirebaseLogBundle, fn: string | undefined): SystemEntry {
  let text = stripAnsi(bundle.message).replace(/^\n+|\n+$/g, '');
  let emulator = bundle.data.metadata?.emulator?.name;
  const prefix = CLI_PREFIX_RE.exec(text);
  if (prefix) {
    emulator ??= prefix[1]!.replace(/\[.*$/, '');
    text = text.slice(prefix[0].length);
  }
  const { message, stack } = splitStack(text);
  return {
    kind: 'system',
    id,
    ts: bundle.timestamp,
    ...(fn !== undefined && { fn }),
    level: bundleLevel(bundle.level),
    message,
    ...(stack && { stack }),
    ...(emulator && { emulator }),
  };
}

function bundleLevel(level: string): LogLevel {
  return level === 'error' || level === 'warn' || level === 'debug' ? level : 'info';
}

function nestLevel(level: string): LogLevel {
  if (level === 'ERROR' || level === 'FATAL') return 'error';
  if (level === 'WARN') return 'warn';
  if (level === 'DEBUG' || level === 'VERBOSE') return 'debug';
  return 'info';
}

/** Split trailing `    at …` frames off a message. */
function splitStack(text: string): { message: string; stack?: string } {
  const lines = text.split('\n');
  const first = lines.findIndex((l) => STACK_FRAME_RE.test(l));
  if (first <= 0) return { message: text };
  return {
    message: lines.slice(0, first).join('\n').trimEnd(),
    stack: lines.slice(first).join('\n'),
  };
}

function findHandler(message: string, value: LogValue | undefined): string | undefined {
  if (value?.kind === 'object') {
    const controller = stringProp(value.props, 'controller');
    const handler = stringProp(value.props, 'handler');
    if (controller && handler) return `${controller}.${handler}`;
  }
  return HANDLER_RE.exec(message)?.[1];
}

function stringProp(props: LogProp[], key: string): string | undefined {
  const value = props.find((p) => p.key === key)?.value;
  return value?.kind === 'string' ? value.value : undefined;
}
