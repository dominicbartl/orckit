import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParsedLogsConfig } from '../../src/config/schema.js';
import type { ProcessState } from '../../src/orchestrator/lifecycle.js';
import {
  createFirebaseLogAssembler,
  type FirebaseLogBundle,
  type FirebaseLogEntry,
} from '../../src/logs/firebase.js';
import {
  trackParsedLogs,
  type ParsedLogEvent,
  type ParsedLogsHost,
  type ParsedLogTracker,
} from '../../src/logs/tracker.js';
import { startFakeEmulator, userBundle, type FakeEmulator } from './fake-emulator.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/firebase-logging');
const burst = readFileSync(join(FIXTURES, 'concurrent-burst-404.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as FirebaseLogBundle);

/** What the assembler alone makes of a bundle list — the tracker must match it. */
function assembled(bundles: FirebaseLogBundle[]): FirebaseLogEntry[] {
  const a = createFirebaseLogAssembler();
  return [...bundles.flatMap((b) => a.push(b)), ...a.flush()];
}

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

/** An Orckit stand-in: lifecycle events plus `inspect().state`. */
class FakeHost extends EventEmitter implements ParsedLogsHost {
  states = new Map<string, ProcessState>();
  inspect(name: string) {
    const state = this.states.get(name);
    if (!state) throw new Error(`unknown process ${name}`);
    return { state };
  }
}

async function setup(
  opts: {
    history?: FirebaseLogBundle[];
    bufferSize?: number;
    running?: boolean;
  } = {},
) {
  const fake: FakeEmulator = await startFakeEmulator({ history: opts.history });
  cleanups.push(() => fake.close());
  const host = new FakeHost();
  host.states.set('emulators', opts.running ? 'running' : 'pending');
  host.states.set('web', 'running');
  const config: ParsedLogsConfig = {
    source: 'firebase',
    hub: fake.hub,
    buffer_size: opts.bufferSize ?? 5000,
  };
  const tracker: ParsedLogTracker = trackParsedLogs(host, {
    processes: { emulators: config },
    retryMs: 10,
    maxRetryMs: 40,
  });
  cleanups.push(() => tracker.dispose());
  const events: ParsedLogEvent[] = [];
  tracker.subscribe((e) => events.push(e));
  return { fake, host, tracker, events };
}

const waitFor = (fn: () => void) => vi.waitFor(fn, { timeout: 3000, interval: 5 });
const stateOf = (t: ParsedLogTracker) => t.state('emulators')?.state;

describe('trackParsedLogs', () => {
  it('starts idle and connects when the process spawns', async () => {
    const { host, tracker, fake } = await setup();
    expect(tracker.names()).toEqual(['emulators']);
    expect(tracker.state('emulators')).toEqual({ source: 'firebase', state: 'idle' });
    expect(fake.connections()).toBe(0);

    host.emit('process:spawned', 'emulators', 123, 'pnpm emulators');
    await waitFor(() => expect(stateOf(tracker)).toBe('connected'));
  });

  it('connects at once when attached to a process that is already running', async () => {
    const { tracker } = await setup({ running: true });
    await waitFor(() => expect(stateOf(tracker)).toBe('connected'));
  });

  it('turns the replayed history into the same entries the assembler makes', async () => {
    const { host, tracker, events } = await setup({ history: burst });
    host.emit('process:spawned', 'emulators');
    const expected = assembled(burst);
    // The last entry is only released by the quiet-period flush.
    await waitFor(() => expect(tracker.entries('emulators')).toEqual(expected));

    // Subscribers lag the buffer by up to one batching window.
    const delivered = () => events.flatMap((e) => (e.type === 'entries' ? e.entries : []));
    await waitFor(() => expect(delivered()).toEqual(expected));
    // Replays arrive batched, not one event per entry.
    expect(events.filter((e) => e.type === 'entries').length).toBeLessThan(expected.length);
    expect(events.findIndex((e) => e.type === 'reset')).toBeLessThan(
      events.findIndex((e) => e.type === 'entries'),
    );
  });

  it('streams live entries after the replay', async () => {
    const { host, tracker, fake } = await setup();
    host.emit('process:spawned', 'emulators');
    await waitFor(() => expect(stateOf(tracker)).toBe('connected'));
    fake.emit(userBundle('europe-west1-api', 1, 'Billing.charge took 3ms'));
    await waitFor(() =>
      expect(tracker.entries('emulators')).toMatchObject([
        { kind: 'log', fn: 'europe-west1-api', handler: 'Billing.charge' },
      ]),
    );
  });

  it('resets on reconnect instead of duplicating the replay', async () => {
    const { host, tracker, fake, events } = await setup({ history: burst });
    host.emit('process:spawned', 'emulators');
    const expected = assembled(burst);
    await waitFor(() => expect(tracker.entries('emulators')).toHaveLength(expected.length));

    expect(tracker.generation('emulators')).toBe(1);
    fake.dropClients();
    await waitFor(() => expect(events.filter((e) => e.type === 'reset')).toHaveLength(2));
    await waitFor(() => expect(tracker.entries('emulators')).toEqual(expected));

    // Each connection is a generation; every batch is tagged with its own.
    expect(tracker.generation('emulators')).toBe(2);
    expect(events.flatMap((e) => (e.type === 'reset' ? [e.generation] : []))).toEqual([1, 2]);
    await waitFor(() => {
      const last = events.filter((e) => e.type === 'entries').at(-1);
      expect(last).toMatchObject({ generation: 2 });
    });
    const resetAt = events.findIndex((e) => e.type === 'reset' && e.generation === 2);
    expect(events.slice(resetAt).every((e) => e.type !== 'entries' || e.generation === 2)).toBe(
      true,
    );
    expect(tracker.generation('unknown')).toBe(0);
  });

  it('tracks executions in flight', async () => {
    const begin = burst.filter((b) => b.message.startsWith('Beginning'));
    const { host, tracker } = await setup({ history: begin.slice(0, 3) });
    host.emit('process:spawned', 'emulators');
    await waitFor(() => expect(tracker.inFlight('emulators').get('europe-west1-api')).toBe(3));
    expect(tracker.inFlight('nope').size).toBe(0);
  });

  it('closes on stop, flushes what was held back, and keeps the entries', async () => {
    const { host, tracker, fake } = await setup();
    host.emit('process:spawned', 'emulators');
    await waitFor(() => expect(fake.clients()).toBe(1));
    // An open dump: without a flush it would stay held back.
    fake.emit(userBundle('api', 1, 'dump {'));
    await waitFor(() => expect(stateOf(tracker)).toBe('connected'));
    await new Promise((r) => setTimeout(r, 20));

    host.emit('process:stopping', 'emulators');
    expect(stateOf(tracker)).toBe('idle');
    expect(tracker.entries('emulators')).toMatchObject([{ kind: 'log', message: 'dump {' }]);
    await waitFor(() => expect(fake.clients()).toBe(0));

    // A later stop event for the same process is harmless.
    host.emit('process:stopped', 'emulators');
    expect(tracker.entries('emulators')).toHaveLength(1);
  });

  it.each(['process:failed', 'process:finished'])('closes on %s', async (event) => {
    const { host, tracker, fake } = await setup();
    host.emit('process:spawned', 'emulators');
    await waitFor(() => expect(fake.clients()).toBe(1));
    host.emit(event, 'emulators');
    expect(stateOf(tracker)).toBe('idle');
    await waitFor(() => expect(fake.clients()).toBe(0));
  });

  it('reconnects fresh on the next spawn (restart)', async () => {
    const { host, tracker, fake, events } = await setup({ history: burst });
    host.emit('process:spawned', 'emulators');
    await waitFor(() => expect(stateOf(tracker)).toBe('connected'));
    host.emit('process:failed', 'emulators');
    host.emit('process:spawned', 'emulators');
    // The first connection's entries stay readable until the second one's
    // reset, so wait for that before comparing — not for the server's accept.
    await waitFor(() => expect(events.filter((e) => e.type === 'reset')).toHaveLength(2));
    expect(fake.connections()).toBe(2);
    await waitFor(() => expect(tracker.entries('emulators')).toEqual(assembled(burst)));
  });

  it('keeps only the newest buffer_size entries', async () => {
    const { host, tracker } = await setup({ history: burst, bufferSize: 5 });
    host.emit('process:spawned', 'emulators');
    const expected = assembled(burst);
    await waitFor(() => expect(tracker.entries('emulators')).toEqual(expected.slice(-5)));
    expect(tracker.entries('emulators', 2)).toEqual(expected.slice(-2));
    expect(tracker.entries('emulators', 0)).toEqual([]);
    expect(tracker.entries('unknown')).toEqual([]);
  });

  it('ignores processes without a log source', async () => {
    const { host, tracker, fake } = await setup();
    host.emit('process:spawned', 'web');
    host.emit('process:stopped', 'web');
    expect(tracker.state('web')).toBeUndefined();
    expect(fake.connections()).toBe(0);
  });

  it('keeps delivering when a subscriber throws', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    cleanups.push(() => logged.mockRestore());
    const { host, tracker, events } = await setup({ history: burst });
    tracker.subscribe(() => {
      throw new Error('boom');
    });
    host.emit('process:spawned', 'emulators');
    await waitFor(() => expect(events.some((e) => e.type === 'entries')).toBe(true));
  });

  it('stops listening and closes sockets on dispose', async () => {
    const { host, tracker, fake, events } = await setup();
    host.emit('process:spawned', 'emulators');
    await waitFor(() => expect(fake.clients()).toBe(1));
    tracker.dispose();
    await waitFor(() => expect(fake.clients()).toBe(0));
    expect(host.listenerCount('process:spawned')).toBe(0);

    const seen = events.length;
    host.emit('process:spawned', 'emulators');
    await new Promise((r) => setTimeout(r, 60));
    expect(fake.connections()).toBe(1);
    expect(events).toHaveLength(seen);
  });
});
