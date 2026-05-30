import type { ServerResponse } from 'node:http';
import type { Orckit, OrckitEvents } from '../orchestrator/orchestrator.js';
import { reduceBuild } from '../process/parsers.js';

/**
 * Push every relevant orckit event to a single SSE client. Returns a
 * `dispose()` that detaches all listeners — the caller invokes it when the
 * underlying socket closes.
 *
 * Event payloads are deliberately shallow: just enough to let the frontend
 * reconcile against the snapshot it already has. Heavy data (full log lines,
 * graph topology) flows via `process:line` events and the initial snapshot
 * fetch, not via SSE replays.
 */
export function streamOrckitEvents(orckit: Orckit, res: ServerResponse): () => void {
  const send = (event: string, data: unknown) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Heartbeat keeps proxies/intermediaries from idling the connection out, and
  // lets the client detect a dead server within a known interval.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(`: ping\n\n`);
  }, 15_000);

  const listeners: Array<[keyof OrckitEvents, (...args: never[]) => void]> = [];

  const on = <K extends keyof OrckitEvents>(
    name: K,
    handler: (...args: OrckitEvents[K]) => void,
  ) => {
    // The strict EventEmitter signature uses a conditional type for the
    // listener; the function shape is structurally identical, just narrowed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    orckit.on(name, handler as any);
    listeners.push([name, handler as (...args: never[]) => void]);
  };

  on('process:state', (name, state) => send('state', { name, state }));
  on('process:starting', (name) => send('starting', { name }));
  on('process:ready', (name, durationMs) => send('ready', { name, durationMs }));
  on('process:running', (name) => send('running', { name }));
  on('process:finished', (name, durationMs) => send('finished', { name, durationMs }));
  on('process:stopping', (name) => send('stopping', { name }));
  on('process:killed', (name, signal) => send('killed', { name, signal }));
  on('process:port-freed', (name, port, pid) => send('port-freed', { name, port, pid }));
  on('process:stopped', (name, durationMs) => send('stopped', { name, durationMs }));
  on('process:failed', (name, error) => send('failed', { name, error: error?.message }));
  on('process:restarting', (name, attempt) => send('restarting', { name, attempt }));
  on('process:line', (name, line) =>
    send('line', {
      name,
      text: line.text,
      stream: line.stream,
      timestamp: line.timestamp,
      highlight: line.highlight,
    }),
  );
  // Send the reduced build *status* (current state) rather than the raw
  // momentary event — the client pins it next to the process, so it wants
  // "where the build stands" not "what just happened".
  on('process:build', (name, event) => send('build', { name, build: reduceBuild(event) }));
  on('boot:complete', (summary) => send('boot:complete', summary));
  on('all:ready', (names) => send('all:ready', { names }));

  return () => {
    clearInterval(heartbeat);
    for (const [name, handler] of listeners) orckit.off(name, handler);
  };
}
