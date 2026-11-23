import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import type { FirebaseLogBundle } from '../../src/logs/firebase.js';

/**
 * A stand-in for the Firebase Emulator Hub + logging emulator: `GET /emulators`
 * on the hub, and a WebSocket that replays its whole history to every new
 * socket before streaming live bundles — what firebase-tools' transport does.
 */
export interface FakeEmulator {
  /** `host:port` of the hub. */
  hub: string;
  /** Whether the hub lists a logging emulator. */
  setLogging(on: boolean): void;
  /** Append to the history and send to every connected socket. */
  emit(bundle: FirebaseLogBundle): void;
  /** Send a raw frame (to test malformed input). */
  emitRaw(data: string): void;
  /** Drop every socket, as if the emulator restarted its transport. */
  dropClients(): void;
  /** Sockets currently open. */
  clients(): number;
  /** Total sockets accepted so far. */
  connections(): number;
  close(): Promise<void>;
}

export async function startFakeEmulator(
  opts: { history?: FirebaseLogBundle[]; logging?: boolean; loggingHost?: string } = {},
): Promise<FakeEmulator> {
  const history = [...(opts.history ?? [])];
  let logging = opts.logging ?? true;
  let accepted = 0;

  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(wss, 'listening');
  const wsPort = (wss.address() as AddressInfo).port;
  wss.on('connection', (socket) => {
    accepted++;
    for (const bundle of history) socket.send(JSON.stringify(bundle));
  });

  const hub: Server = createServer((req, res) => {
    if (req.url !== '/emulators') {
      res.writeHead(404).end();
      return;
    }
    const emulators: Record<string, unknown> = {
      hub: { name: 'hub', host: '127.0.0.1', port: hubPort },
    };
    if (logging) {
      emulators.logging = { name: 'logging', host: opts.loggingHost ?? '127.0.0.1', port: wsPort };
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(emulators));
  });
  hub.listen(0, '127.0.0.1');
  await once(hub, 'listening');
  const hubPort = (hub.address() as AddressInfo).port;

  const broadcast = (data: string) => {
    for (const client of wss.clients) client.send(data);
  };

  return {
    hub: `127.0.0.1:${hubPort}`,
    setLogging: (on) => {
      logging = on;
    },
    emit(bundle) {
      history.push(bundle);
      broadcast(JSON.stringify(bundle));
    },
    emitRaw: broadcast,
    dropClients() {
      for (const client of wss.clients) client.terminate();
    },
    clients: () => [...wss.clients].filter((c) => c.readyState === c.OPEN).length,
    connections: () => accepted,
    async close() {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      hub.closeAllConnections();
      await new Promise<void>((resolve) => hub.close(() => resolve()));
    },
  };
}

/** One bundle shaped like a recorded user log line. */
export function userBundle(fn: string, timestamp: number, text: string): FirebaseLogBundle {
  const message = `>  ${text}`;
  return {
    level: 'info',
    timestamp,
    message,
    data: {
      user: text,
      metadata: { emulator: { name: 'functions' }, function: { name: fn }, message },
    },
  };
}
