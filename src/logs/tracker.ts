/**
 * Keeps parsed log entries for every process with a structured log source, for
 * the web dashboard and the MCP server to read. One tracker per `orc start`: it
 * owns the sockets, so unlike `trackBuilds` it is created once and shared.
 *
 * Per process it opens the source when the process spawns and closes it when
 * the process stops, fails or finishes. Entries survive the close (a crashed
 * emulator's last logs stay readable) until the next connection, which replays
 * the emulator's whole history and so starts from empty.
 */

import type { ParsedLogsConfig } from '../config/schema.js';
import type { ProcessState } from '../orchestrator/lifecycle.js';
import { createDebug } from '../reporter/debug.js';
import {
  MERGE_GAP_MS,
  createFirebaseLogAssembler,
  type FirebaseLogAssembler,
  type FirebaseLogBundle,
  type FirebaseLogEntry,
} from './firebase.js';
import {
  connectFirebaseLogs,
  type FirebaseSource,
  type FirebaseSourceOptions,
  type FirebaseSourceState,
} from './firebase-source.js';

const debug = createDebug('ParsedLogs');

/** Where a process's log source stands. `idle`: the process isn't running. */
export type ParsedLogState = { source: ParsedLogsConfig['source'] } & (
  | { state: 'idle' }
  | FirebaseSourceState
);

/**
 * `generation` counts connections. Entry ids restart at 0 with each one, so a
 * consumer that fetched `entries()` and also listens here drops anything whose
 * generation isn't the one it holds.
 */
export type ParsedLogEvent =
  /** New entries, in timeline order, appended to `entries(name)`. */
  | { type: 'entries'; name: string; generation: number; entries: FirebaseLogEntry[] }
  /** The source reconnected: drop what you have, the history replays next. */
  | { type: 'reset'; name: string; generation: number }
  | { type: 'state'; name: string; state: ParsedLogState };

export interface ParsedLogTracker {
  /** Processes with a log source, in config order. */
  names(): string[];
  state(name: string): ParsedLogState | undefined;
  /** The newest `limit` entries (default all kept), oldest first. */
  entries(name: string, limit?: number): FirebaseLogEntry[];
  /** The connection the current entries belong to (0 before the first). */
  generation(name: string): number;
  /** How many entries `entries(name)` returns, without copying them. */
  count(name: string): number;
  /** Executions currently running per function. */
  inFlight(name: string): ReadonlyMap<string, number>;
  /** Returns an unsubscribe function. */
  subscribe(listener: (event: ParsedLogEvent) => void): () => void;
  dispose(): void;
}

type LifecycleEvent =
  | 'process:spawned'
  | 'process:stopping'
  | 'process:stopped'
  | 'process:failed'
  | 'process:finished';

/** The slice of `Orckit` the tracker needs. */
export interface ParsedLogsHost {
  on(event: LifecycleEvent, listener: (name: string) => void): unknown;
  off(event: LifecycleEvent, listener: (name: string) => void): unknown;
  inspect(name: string): { state: ProcessState };
}

export interface TrackParsedLogsOptions {
  /** Log source per process name; processes not listed are ignored. */
  processes: Record<string, ParsedLogsConfig>;
  /** Source tuning, for tests. */
  retryMs?: number;
  maxRetryMs?: number;
}

interface ProcessLogs {
  config: ParsedLogsConfig;
  state: ParsedLogState;
  entries: FirebaseLogEntry[];
  assembler: FirebaseLogAssembler;
  source: FirebaseSource | null;
  flushTimer: NodeJS.Timeout | undefined;
  generation: number;
}

const ACTIVE: ReadonlySet<ProcessState> = new Set(['starting', 'ready', 'running']);
const NO_FLIGHTS: ReadonlyMap<string, number> = new Map();
/** Subscriber batching window — one animation frame. */
const DISPATCH_MS = 16;

export function trackParsedLogs(
  host: ParsedLogsHost,
  opts: TrackParsedLogsOptions,
): ParsedLogTracker {
  const procs = new Map<string, ProcessLogs>();
  const listeners = new Set<(event: ParsedLogEvent) => void>();
  /**
   * Entries not yet delivered to subscribers. Every WebSocket message is its
   * own macrotask, so batching per tick barely coalesces a replay (measured:
   * ~5k entries in ~1.2k batches); a frame-sized window does.
   */
  const pending = new Map<string, FirebaseLogEntry[]>();
  let dispatchScheduled: NodeJS.Timeout | undefined;

  for (const [name, config] of Object.entries(opts.processes)) {
    procs.set(name, {
      config,
      state: { source: config.source, state: 'idle' },
      entries: [],
      assembler: createFirebaseLogAssembler(),
      source: null,
      flushTimer: undefined,
      generation: 0,
    });
  }

  const emit = (event: ParsedLogEvent) => {
    for (const listener of listeners) {
      // A throwing subscriber must not take the socket callback (and with it
      // the process, via uncaughtException) down.
      try {
        listener(event);
      } catch (err) {
        debug.error('parsed-log subscriber threw', err);
      }
    }
  };

  const dispatch = () => {
    // Also called directly (before a reset), so cancel the scheduled run.
    clearTimeout(dispatchScheduled);
    dispatchScheduled = undefined;
    const batches = [...pending];
    pending.clear();
    // A reset dispatches first, so every batch belongs to the current generation.
    for (const [name, entries] of batches) {
      emit({ type: 'entries', name, generation: procs.get(name)!.generation, entries });
    }
  };

  const append = (name: string, p: ProcessLogs, entries: FirebaseLogEntry[]) => {
    if (entries.length === 0) return;
    p.entries.push(...entries);
    // Trim in chunks so a long replay doesn't splice the array on every entry.
    const cap = p.config.buffer_size;
    if (p.entries.length > cap + Math.min(cap, 1000)) p.entries.splice(0, p.entries.length - cap);
    const queued = pending.get(name);
    if (queued) queued.push(...entries);
    else pending.set(name, [...entries]);
    dispatchScheduled ??= setTimeout(dispatch, DISPATCH_MS);
  };

  const setState = (name: string, p: ProcessLogs, state: ParsedLogState) => {
    p.state = state;
    emit({ type: 'state', name, state });
  };

  const flush = (name: string, p: ProcessLogs) => {
    clearTimeout(p.flushTimer);
    p.flushTimer = undefined;
    append(name, p, p.assembler.flush());
  };

  const open = (name: string) => {
    const p = procs.get(name);
    if (!p) return;
    close(name);
    const handlers: FirebaseSourceOptions = {
      hub: p.config.hub,
      retryMs: opts.retryMs,
      maxRetryMs: opts.maxRetryMs,
      onConnect: () => {
        // Deliver what the old connection produced before telling
        // subscribers to drop it, so nothing stale arrives after the reset.
        dispatch();
        clearTimeout(p.flushTimer);
        p.flushTimer = undefined;
        p.entries = [];
        p.assembler = createFirebaseLogAssembler();
        p.generation++;
        emit({ type: 'reset', name, generation: p.generation });
      },
      onBundle: (bundle: FirebaseLogBundle) => {
        append(name, p, p.assembler.push(bundle));
        // The last log line is held until the stream goes quiet.
        clearTimeout(p.flushTimer);
        p.flushTimer = setTimeout(() => flush(name, p), MERGE_GAP_MS);
      },
      onState: (state) => setState(name, p, { source: p.config.source, ...state }),
    };
    p.source = connectFirebaseLogs(handlers);
  };

  const close = (name: string) => {
    const p = procs.get(name);
    if (!p?.source) return;
    p.source.close();
    p.source = null;
    flush(name, p);
    setState(name, p, { source: p.config.source, state: 'idle' });
  };

  const onSpawned = (name: string) => open(name);
  const onEnded = (name: string) => close(name);
  const ended: LifecycleEvent[] = [
    'process:stopping',
    'process:stopped',
    'process:failed',
    'process:finished',
  ];
  host.on('process:spawned', onSpawned);
  for (const event of ended) host.on(event, onEnded);

  // Attached to an orckit that is already running something.
  for (const name of procs.keys()) {
    try {
      if (ACTIVE.has(host.inspect(name).state)) open(name);
    } catch {
      // not a known process — nothing to watch
    }
  }

  return {
    names: () => [...procs.keys()],
    state: (name) => procs.get(name)?.state,
    entries(name, limit) {
      const p = procs.get(name);
      if (!p) return [];
      // The array may run past the cap between trims; never hand that out.
      const keep = Math.min(limit ?? Infinity, p.config.buffer_size);
      return keep > 0 ? p.entries.slice(-keep) : [];
    },
    generation: (name) => procs.get(name)?.generation ?? 0,
    count(name) {
      const p = procs.get(name);
      return p ? Math.min(p.entries.length, p.config.buffer_size) : 0;
    },
    inFlight: (name) => procs.get(name)?.assembler.inFlight() ?? NO_FLIGHTS,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      host.off('process:spawned', onSpawned);
      for (const event of ended) host.off(event, onEnded);
      for (const p of procs.values()) {
        p.source?.close();
        p.source = null;
        clearTimeout(p.flushTimer);
      }
      clearTimeout(dispatchScheduled);
      pending.clear();
      listeners.clear();
    },
  };
}
