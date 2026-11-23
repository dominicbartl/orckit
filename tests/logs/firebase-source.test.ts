import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FirebaseLogBundle } from '../../src/logs/firebase.js';
import {
  LOGGING_EMULATOR_HINT,
  connectFirebaseLogs,
  type FirebaseSource,
  type FirebaseSourceState,
} from '../../src/logs/firebase-source.js';
import { startFakeEmulator, userBundle, type FakeEmulator } from './fake-emulator.js';

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

async function emulator(opts?: Parameters<typeof startFakeEmulator>[0]): Promise<FakeEmulator> {
  const fake = await startFakeEmulator(opts);
  cleanups.push(() => fake.close());
  return fake;
}

/** Connect with fast retries and record everything the source reports. */
function connect(hub: string) {
  const log: (
    | { kind: 'connect' }
    | { kind: 'bundle'; bundle: FirebaseLogBundle }
    | { kind: 'state'; state: FirebaseSourceState }
  )[] = [];
  const source: FirebaseSource = connectFirebaseLogs({
    hub,
    retryMs: 10,
    maxRetryMs: 40,
    onConnect: () => log.push({ kind: 'connect' }),
    onBundle: (bundle) => log.push({ kind: 'bundle', bundle }),
    onState: (state) => log.push({ kind: 'state', state }),
  });
  cleanups.push(() => source.close());
  return {
    source,
    log,
    bundles: () => log.flatMap((e) => (e.kind === 'bundle' ? [e.bundle.message] : [])),
    states: () => log.flatMap((e) => (e.kind === 'state' ? [e.state.state] : [])),
    connects: () => log.filter((e) => e.kind === 'connect').length,
  };
}

const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 3000, interval: 5 });

describe('connectFirebaseLogs', () => {
  it('replays the history after connecting, then streams live bundles', async () => {
    const fake = await emulator({ history: [userBundle('api', 1, 'old one')] });
    const c = connect(fake.hub);

    await waitFor(() => expect(c.bundles()).toEqual(['>  old one']));
    // Connect is reported before the replay, so a consumer can reset first.
    expect(c.log.map((e) => e.kind)).toEqual(['state', 'connect', 'state', 'bundle']);
    expect(c.states()).toEqual(['connecting', 'connected']);

    fake.emit(userBundle('api', 2, 'live one'));
    await waitFor(() => expect(c.bundles()).toEqual(['>  old one', '>  live one']));
  });

  it('reports a missing logging emulator with a hint, then connects once it appears', async () => {
    const fake = await emulator({ logging: false });
    const c = connect(fake.hub);
    await waitFor(() =>
      expect(c.log).toContainEqual({
        kind: 'state',
        state: { state: 'unavailable', detail: LOGGING_EMULATOR_HINT },
      }),
    );
    expect(fake.connections()).toBe(0);

    fake.setLogging(true);
    await waitFor(() => expect(c.states().at(-1)).toBe('connected'));
  });

  it('waits for a hub that is not up yet', async () => {
    const port = await freePort();
    const c = connect(`127.0.0.1:${port}`);
    await waitFor(() =>
      expect(c.log).toContainEqual({
        kind: 'state',
        state: { state: 'waiting', detail: `waiting for the emulator hub at 127.0.0.1:${port}` },
      }),
    );
    expect(c.connects()).toBe(0);
  });

  it('reconnects after a drop and receives the replayed history again', async () => {
    const fake = await emulator({ history: [userBundle('api', 1, 'a')] });
    const c = connect(fake.hub);
    await waitFor(() => expect(c.connects()).toBe(1));

    fake.dropClients();
    await waitFor(() => expect(c.connects()).toBe(2));
    expect(c.bundles()).toEqual(['>  a', '>  a']);
    expect(c.states()).toEqual(['connecting', 'connected', 'connecting', 'connected']);
  });

  it('connects to the hub host when the logging emulator binds a wildcard address', async () => {
    const fake = await emulator({ loggingHost: '0.0.0.0' });
    const c = connect(fake.hub);
    await waitFor(() =>
      expect(c.log).toContainEqual({
        kind: 'state',
        state: { state: 'connected', url: expect.stringMatching(/^ws:\/\/127\.0\.0\.1:\d+$/) },
      }),
    );
  });

  it('ignores malformed messages and keeps the socket', async () => {
    const fake = await emulator();
    const c = connect(fake.hub);
    await waitFor(() => expect(c.connects()).toBe(1));

    fake.emitRaw('not json');
    fake.emitRaw(JSON.stringify({ no: 'timestamp' }));
    fake.emit(userBundle('api', 3, 'fine'));
    await waitFor(() => expect(c.bundles()).toEqual(['>  fine']));
    expect(c.connects()).toBe(1);
  });

  it('fills in missing level and data', async () => {
    const fake = await emulator();
    const c = connect(fake.hub);
    await waitFor(() => expect(c.connects()).toBe(1));
    fake.emitRaw(JSON.stringify({ timestamp: 5, message: 'bare' }));
    await waitFor(() =>
      expect(c.log).toContainEqual({
        kind: 'bundle',
        bundle: { level: 'info', timestamp: 5, message: 'bare', data: {} },
      }),
    );
  });

  it('goes silent and closes its socket on close()', async () => {
    const fake = await emulator();
    const c = connect(fake.hub);
    await waitFor(() => expect(fake.clients()).toBe(1));

    c.source.close();
    const seen = c.log.length;
    fake.emit(userBundle('api', 9, 'after close'));
    await waitFor(() => expect(fake.clients()).toBe(0));
    await new Promise((r) => setTimeout(r, 60));
    expect(c.log).toHaveLength(seen);
    expect(fake.connections()).toBe(1);
  });

  it('stops retrying once closed', async () => {
    const fake = await emulator({ logging: false });
    const c = connect(fake.hub);
    await waitFor(() => expect(c.states()).toContain('unavailable'));
    c.source.close();
    fake.setLogging(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(fake.connections()).toBe(0);
  });
});

/** A port nothing listens on (bound, then released). */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
