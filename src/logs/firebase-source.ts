/**
 * Live connection to the Firebase logging emulator's WebSocket. Asks the
 * Emulator Hub (`GET /emulators`) where the logging emulator listens, connects,
 * and keeps reconnecting with backoff until closed — the emulators boot after
 * orckit spawns them, and restart with the process.
 *
 * The logging emulator replays its whole history to every new socket, so each
 * `onConnect` means "everything you had is about to arrive again": the caller
 * resets its state there rather than de-duplicating.
 */

import { createDebug } from '../reporter/debug.js';
import type { FirebaseLogBundle } from './firebase.js';

const debug = createDebug('ParsedLogs');

export type FirebaseSourceState =
  /** First attempt, or reconnecting after the socket dropped. */
  | { state: 'connecting' }
  | { state: 'connected'; url: string }
  /** The hub or the socket isn't reachable yet — normal while the emulators boot. */
  | { state: 'waiting'; detail: string }
  /** The hub is up but runs no logging emulator: needs a config change. */
  | { state: 'unavailable'; detail: string };

export interface FirebaseSourceOptions {
  /** `host:port` of the Emulator Hub. */
  hub: string;
  /** A new socket is open; the emulator's full history replays next. */
  onConnect(): void;
  onBundle(bundle: FirebaseLogBundle): void;
  /** Called on every change of state (never twice with the same one). */
  onState(state: FirebaseSourceState): void;
  /** First retry delay in ms; doubles per failure up to `maxRetryMs`. Default 500. */
  retryMs?: number;
  /** Default 5000. */
  maxRetryMs?: number;
}

export interface FirebaseSource {
  /** Stop for good: no callbacks fire after this returns. */
  close(): void;
}

const HUB_TIMEOUT_MS = 2000;

export const LOGGING_EMULATOR_HINT =
  'the logging emulator is not running — enable the Emulator UI (emulators.ui in firebase.json) ' +
  'or set START_LOGGING_EMULATOR=true in the process env';

export function connectFirebaseLogs(opts: FirebaseSourceOptions): FirebaseSource {
  const retryMs = opts.retryMs ?? 500;
  const maxRetryMs = opts.maxRetryMs ?? 5000;
  let closed = false;
  let delay = retryMs;
  let timer: NodeJS.Timeout | undefined;
  let socket: WebSocket | null = null;
  let discovery: AbortController | null = null;
  let lastState = '';

  const setState = (state: FirebaseSourceState) => {
    const key = JSON.stringify(state);
    if (closed || key === lastState) return;
    lastState = key;
    opts.onState(state);
  };

  const retry = (state: FirebaseSourceState) => {
    if (closed) return;
    setState(state);
    timer = setTimeout(() => void attempt(), delay);
    delay = Math.min(delay * 2, maxRetryMs);
  };

  const attempt = async () => {
    timer = undefined;
    discovery = new AbortController();
    const found = await discover(opts.hub, discovery.signal);
    discovery = null;
    if (closed) return;
    if ('state' in found) retry(found);
    else open(found.url);
  };

  const open = (url: string) => {
    let opened = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      retry({ state: 'waiting', detail: `invalid logging emulator address ${url}: ${err}` });
      return;
    }
    socket = ws;
    ws.onopen = () => {
      if (closed || socket !== ws) return;
      opened = true;
      delay = retryMs;
      opts.onConnect();
      setState({ state: 'connected', url });
    };
    ws.onmessage = (event) => {
      if (closed || socket !== ws) return;
      const bundle = toBundle(event.data);
      if (bundle) opts.onBundle(bundle);
      else debug.debug('ignoring a malformed logging-emulator message');
    };
    // An error is always followed by close; recovery lives there.
    ws.onerror = () => {};
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      retry(
        opened
          ? { state: 'connecting' }
          : { state: 'waiting', detail: `cannot connect to the logging emulator at ${url}` },
      );
    };
  };

  setState({ state: 'connecting' });
  void attempt();

  return {
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      discovery?.abort();
      const ws = socket;
      socket = null;
      ws?.close();
    },
  };
}

/** Ask the hub where the logging emulator listens. */
async function discover(
  hub: string,
  signal: AbortSignal,
): Promise<{ url: string } | FirebaseSourceState> {
  let emulators: Record<string, { host?: string; port?: number } | undefined>;
  try {
    const res = await fetch(`http://${hub}/emulators`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(HUB_TIMEOUT_MS)]),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    emulators = (await res.json()) as typeof emulators;
  } catch (err) {
    debug.debug(`emulator hub ${hub} not reachable`, (err as Error).message);
    return { state: 'waiting', detail: `waiting for the emulator hub at ${hub}` };
  }
  const logging = emulators?.logging;
  if (!logging?.port) return { state: 'unavailable', detail: LOGGING_EMULATOR_HINT };
  return { url: `ws://${reachableHost(logging.host, hub)}:${logging.port}` };
}

/** A wildcard bind address isn't connectable; fall back to the host the hub answered on. */
function reachableHost(host: string | undefined, hub: string): string {
  const hubHost = hub.replace(/:\d+$/, '');
  if (!host || host === '0.0.0.0' || host === '::' || host === '[::]') return hubHost;
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function toBundle(data: unknown): FirebaseLogBundle | null {
  if (typeof data !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const b = value as Partial<FirebaseLogBundle>;
  if (typeof b.timestamp !== 'number' || typeof b.message !== 'string') return null;
  return {
    level: typeof b.level === 'string' ? b.level : 'info',
    timestamp: b.timestamp,
    message: b.message,
    data: b.data && typeof b.data === 'object' ? b.data : {},
  };
}
