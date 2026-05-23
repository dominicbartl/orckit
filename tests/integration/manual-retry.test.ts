/**
 * Manual retry / partial boot integration tests.
 *
 * Exercises the new behavior added for the "fix-the-error-and-retry" workflow:
 *  - start() tolerates per-process failure and emits boot:complete instead
 *  - dependents of a failed process stay pending
 *  - restart() with cascade replays the whole downstream chain
 *  - successful retry kicks pending dependents into life
 *  - manual restart cancels any queued auto-retry timer
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Orckit } from '../../src/orchestrator/orchestrator.js';
import { validateConfig } from '../../src/config/load.js';

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'orckit-retry-'));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function flagPath(name: string): string {
  return join(tmp, `${name}.flag`);
}

/** Build a command that fails until the flag file appears, then succeeds. */
function flakyCommand(flag: string, lifetime = 'sleep 30'): string {
  return `if [ -f "${flag}" ]; then echo "ready"; ${lifetime}; else echo "no flag yet"; exit 1; fi`;
}

// Every "failed" process in these tests sets manual_retry: true so the
// orchestrator stays alive (otherwise start() throws BootFailedError, which
// is the new default behavior — covered separately below).

describe('Manual retry / partial boot', () => {
  let orckit: Orckit | null = null;

  afterEach(async () => {
    if (orckit) {
      try {
        await orckit.dispose();
      } catch {
        // already stopped
      }
      orckit = null;
    }
  });

  it('start() does not throw when a process fails — emits boot:complete summary', async () => {
    const flag = flagPath('s1');
    orckit = new Orckit(
      validateConfig({
        processes: {
          bad: {
            command: flakyCommand(flag),
            ready: { type: 'log-pattern', pattern: 'ready', timeout_ms: 2000 },
            restart: 'never',
            manual_retry: true,
          },
        },
      }),
    );
    const summary = await orckit.start();
    expect(summary.failed).toEqual(['bad']);
    expect(summary.ready).toEqual([]);
    expect(summary.pending).toEqual([]);
    expect(orckit.state('bad')).toBe('failed');
  });

  it('dependents of a failed process stay pending after start()', async () => {
    const flag = flagPath('s2');
    orckit = new Orckit(
      validateConfig({
        processes: {
          db: {
            command: flakyCommand(flag),
            ready: { type: 'log-pattern', pattern: 'ready', timeout_ms: 2000 },
            restart: 'never',
            manual_retry: true,
          },
          api: {
            command: 'echo "api up"; sleep 30',
            depends_on: ['db'],
            ready: { type: 'log-pattern', pattern: 'api up', timeout_ms: 5000 },
            restart: 'never',
          },
          web: {
            command: 'echo "web up"; sleep 30',
            depends_on: ['api'],
            ready: { type: 'log-pattern', pattern: 'web up', timeout_ms: 5000 },
            restart: 'never',
          },
        },
      }),
    );
    const summary = await orckit.start();
    expect(summary.failed).toEqual(['db']);
    expect(new Set(summary.pending)).toEqual(new Set(['api', 'web']));
    expect(orckit.state('api')).toBe('pending');
    expect(orckit.state('web')).toBe('pending');
  });

  it('manual restart of a failed leaf cascades to dependents and unblocks them', async () => {
    const flag = flagPath('s3');
    orckit = new Orckit(
      validateConfig({
        processes: {
          db: {
            command: flakyCommand(flag),
            ready: { type: 'log-pattern', pattern: 'ready', timeout_ms: 2000 },
            restart: 'never',
            manual_retry: true,
          },
          api: {
            command: 'echo "api up"; sleep 30',
            depends_on: ['db'],
            ready: { type: 'log-pattern', pattern: 'api up', timeout_ms: 5000 },
            restart: 'never',
          },
        },
      }),
    );

    const summary = await orckit.start();
    expect(summary.failed).toEqual(['db']);
    expect(summary.pending).toEqual(['api']);

    // "Fix" the problem — touch the flag file so the next start succeeds.
    writeFileSync(flag, '');

    await orckit.restart(['db']); // cascade is true by default
    expect(orckit.state('db')).toBe('running');
    expect(orckit.state('api')).toBe('running');
  });

  it('no-cascade restart leaves running dependents alone', async () => {
    orckit = new Orckit(
      validateConfig({
        processes: {
          db: {
            command: 'echo "db up"; sleep 30',
            ready: { type: 'log-pattern', pattern: 'db up' },
          },
          api: {
            command: 'echo "api up"; sleep 30',
            depends_on: ['db'],
            ready: { type: 'log-pattern', pattern: 'api up' },
          },
        },
      }),
    );
    await orckit.start();
    expect(orckit.state('api')).toBe('running');

    const transitions: string[] = [];
    orckit.on('process:state', (n, s) => transitions.push(`${n}:${s}`));

    await orckit.restart(['db'], { cascade: false });
    expect(orckit.state('db')).toBe('running');
    expect(orckit.state('api')).toBe('running');

    // api should not have been touched
    expect(transitions.filter((t) => t.startsWith('api:'))).toEqual([]);
  });

  it('cascade restart of an upstream replays the whole chain', async () => {
    orckit = new Orckit(
      validateConfig({
        processes: {
          db: {
            command: 'echo "db up"; sleep 30',
            ready: { type: 'log-pattern', pattern: 'db up' },
          },
          api: {
            command: 'echo "api up"; sleep 30',
            depends_on: ['db'],
            ready: { type: 'log-pattern', pattern: 'api up' },
          },
          web: {
            command: 'echo "web up"; sleep 30',
            depends_on: ['api'],
            ready: { type: 'log-pattern', pattern: 'web up' },
          },
        },
      }),
    );
    await orckit.start();

    const seenStarting: string[] = [];
    orckit.on('process:starting', (n) => seenStarting.push(n));

    await orckit.restart(['db']);

    expect(seenStarting).toEqual(['db', 'api', 'web']);
    expect(orckit.state('db')).toBe('running');
    expect(orckit.state('api')).toBe('running');
    expect(orckit.state('web')).toBe('running');
  });

  it('manual restart preempts a queued auto-retry delay', async () => {
    const flag = flagPath('s5');
    // Use a long restart_delay_ms so auto-retry is definitely still in its
    // delay phase when we manually retry. Without preemption the auto-retry
    // would fire after the manual one and we'd see >1 starting event.
    orckit = new Orckit(
      validateConfig({
        processes: {
          flaky: {
            command: flakyCommand(flag),
            ready: { type: 'log-pattern', pattern: 'ready', timeout_ms: 1000 },
            restart: 'on-failure',
            restart_delay_ms: 5000,
            max_retries: 5,
            manual_retry: true,
          },
        },
      }),
    );

    const startingEvents: string[] = [];
    orckit.on('process:starting', () => startingEvents.push('start'));

    const summary = await orckit.start();
    expect(summary.failed).toEqual(['flaky']);
    expect(startingEvents.length).toBe(1); // initial attempt

    // Touch the flag, then manually restart while auto-retry is still in its 5s delay.
    writeFileSync(flag, '');
    await orckit.restart(['flaky']);

    expect(orckit.state('flaky')).toBe('running');
    // We expect exactly 2 starting events: the initial + the manual. If the
    // auto-retry timer wasn't preempted there would be a third.
    await new Promise((r) => setTimeout(r, 200));
    expect(startingEvents.length).toBe(2);
  });
});
