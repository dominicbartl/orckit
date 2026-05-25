import { createContext, createSignal, onCleanup, useContext, type Accessor } from 'solid-js';
import { createStore, produce, type SetStoreFunction } from 'solid-js/store';
import type { OrckitSnapshot, OutputLine, ProcessSnapshot, ProcessState } from './types';
import { fetchOutput, fetchState } from './api';

/** Maximum buffered log lines per process — mirrors orckit's default buffer cap. */
const MAX_LINES_PER_PROCESS = 1000;

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface OrckitStream {
  /** Project name from the snapshot. */
  project: Accessor<string>;
  /** List of all processes, reactive. */
  processes: Accessor<ProcessSnapshot[]>;
  /** Look up a process by name. */
  process: (name: string) => ProcessSnapshot | undefined;
  /** Reactive list of log lines for a single process. */
  logsFor: (name: string) => Accessor<OutputLine[]>;
  /** SSE connection lifecycle. */
  status: Accessor<ConnectionStatus>;
  /** Project-wide boot summary, if one has fired. */
  bootSummary: Accessor<BootSummary | null>;
  /** Hydrate output buffer for a process from the server (initial backlog). */
  hydrateOutput: (name: string) => Promise<void>;
}

interface BootSummary {
  ready: string[];
  failed: string[];
  pending: string[];
  strictFailures: string[];
}

interface StoreShape {
  project: string;
  processes: Record<string, ProcessSnapshot>;
  /** Insertion order — kept in sync with snapshots so the dashboard list is stable. */
  order: string[];
  /** Per-process log buffers. */
  logs: Record<string, OutputLine[]>;
  bootSummary: BootSummary | null;
}

const initialStore: StoreShape = {
  project: '',
  processes: {},
  order: [],
  logs: {},
  bootSummary: null,
};

/**
 * Open an SSE connection to /events and expose a reactive store of orckit
 * state. The SSE stream always begins with a `snapshot` event so reconnects
 * are self-hydrating; we only fall back to /api/state if the first
 * `snapshot` is delayed past the initial connect.
 *
 * Native EventSource handles reconnect with exponential backoff. We surface
 * connection state for the UI's "connected / reconnecting" indicator.
 */
export function createOrckitStream(): OrckitStream {
  const [store, setStore] = createStore<StoreShape>(structuredClone(initialStore));
  const [status, setStatus] = createSignal<ConnectionStatus>('connecting');

  let source: EventSource | null = null;
  let everConnected = false;

  function open() {
    setStatus(everConnected ? 'reconnecting' : 'connecting');
    source = new EventSource('/events');

    source.addEventListener('open', () => {
      everConnected = true;
      setStatus('connected');
    });

    source.addEventListener('error', () => {
      // Browser will auto-reconnect; readyState transitions to CONNECTING.
      // CLOSED means it gave up (we never see this in practice — only on
      // explicit close()).
      if (source?.readyState === EventSource.CLOSED) {
        setStatus('disconnected');
      } else {
        setStatus('reconnecting');
      }
    });

    bindHandlers(source, setStore);
  }

  open();

  // Fallback hydration: if the server is slow to send the initial snapshot,
  // fetch /api/state explicitly so the UI isn't blank for too long.
  const hydrationTimer = setTimeout(() => {
    if (Object.keys(store.processes).length === 0) {
      void fetchState()
        .then((snap) => applySnapshot(setStore, snap))
        .catch(() => {
          // SSE will retry; nothing to do here
        });
    }
  }, 1500);

  onCleanup(() => {
    clearTimeout(hydrationTimer);
    source?.close();
  });

  return {
    project: () => store.project,
    processes: () => store.order.map((n) => store.processes[n]!).filter(Boolean),
    process: (name) => store.processes[name],
    logsFor: (name) => () => store.logs[name] ?? [],
    status,
    bootSummary: () => store.bootSummary,
    async hydrateOutput(name: string) {
      const lines = await fetchOutput(name);
      setStore(
        produce((s) => {
          s.logs[name] = lines.slice(-MAX_LINES_PER_PROCESS);
        }),
      );
    },
  };
}

function applySnapshot(setStore: SetStoreFunction<StoreShape>, snap: OrckitSnapshot) {
  setStore(
    produce((s) => {
      s.project = snap.project;
      // Preserve any logs we've already buffered — snapshots don't carry them.
      const existingLogs = s.logs;
      const nextProcesses: Record<string, ProcessSnapshot> = {};
      for (const p of snap.processes) nextProcesses[p.name] = p;
      s.processes = nextProcesses;
      s.order = snap.processes.map((p) => p.name);
      // Drop logs for processes that no longer exist (config changed mid-flight).
      const nextLogs: Record<string, OutputLine[]> = {};
      for (const name of s.order) nextLogs[name] = existingLogs[name] ?? [];
      s.logs = nextLogs;
    }),
  );
}

function bindHandlers(source: EventSource, setStore: SetStoreFunction<StoreShape>) {
  source.addEventListener('snapshot', (e) => {
    try {
      applySnapshot(setStore, JSON.parse((e as MessageEvent).data) as OrckitSnapshot);
    } catch {
      // ignore — server should always send valid JSON
    }
  });

  source.addEventListener('state', (e) => {
    const { name, state } = parse<{ name: string; state: ProcessState }>(e);
    setStore(
      produce((s) => {
        const p = s.processes[name];
        if (p) p.state = state;
      }),
    );
  });

  source.addEventListener('ready', (e) => {
    const { name } = parse<{ name: string }>(e);
    setStore(
      produce((s) => {
        const p = s.processes[name];
        if (p) {
          p.lastError = undefined;
          p.startedAt = p.startedAt ?? Date.now();
        }
      }),
    );
  });

  source.addEventListener('failed', (e) => {
    const { name, error } = parse<{ name: string; error?: string }>(e);
    setStore(
      produce((s) => {
        const p = s.processes[name];
        if (p) p.lastError = error ?? 'process failed';
      }),
    );
  });

  source.addEventListener('restarting', (e) => {
    const { name, attempt } = parse<{ name: string; attempt: number }>(e);
    setStore(
      produce((s) => {
        const p = s.processes[name];
        if (p) p.retries = attempt;
      }),
    );
  });

  source.addEventListener('line', (e) => {
    const line = parse<{
      name: string;
      text: string;
      stream: 'stdout' | 'stderr';
      timestamp: number;
      highlight?: string;
    }>(e);
    setStore(
      produce((s) => {
        const buf = s.logs[line.name] ?? (s.logs[line.name] = []);
        buf.push({
          text: line.text,
          stream: line.stream,
          timestamp: line.timestamp,
          highlight: line.highlight,
        });
        if (buf.length > MAX_LINES_PER_PROCESS) {
          buf.splice(0, buf.length - MAX_LINES_PER_PROCESS);
        }
      }),
    );
  });

  source.addEventListener('boot:complete', (e) => {
    const summary = parse<BootSummary>(e);
    setStore('bootSummary', summary);
  });
}

function parse<T>(e: Event): T {
  return JSON.parse((e as MessageEvent).data) as T;
}

/* -------------------------------------------------------------------------
 * Context wrapper so any descendant can read from the same stream without
 * prop-drilling. Sink uses static fixtures and skips this; the dashboard
 * wraps its tree in <OrckitProvider>.
 * ----------------------------------------------------------------------- */

const Context = createContext<OrckitStream | null>(null);

export function OrckitProvider(props: { stream: OrckitStream; children: import('solid-js').JSX.Element }) {
  return <Context.Provider value={props.stream}>{props.children}</Context.Provider>;
}

export function useOrckit(): OrckitStream {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useOrckit must be called within <OrckitProvider>');
  return ctx;
}
