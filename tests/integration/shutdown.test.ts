/**
 * Shutdown / orphan regressions.
 *
 * Every case here spawns REAL bash processes and asserts on what survives a
 * teardown, because that's the only place the bugs lived: a Ctrl-C that landed
 * in a startup window (mid `pre_start` hook, mid health wait, mid boot) used to
 * finish teardown while the startup was still unwinding — and the spawn behind
 * it then fired into the void, producing a detached child nothing would ever
 * kill again. The assertions are therefore mostly "this pid is gone" and "this
 * marker file was never written", not state-machine bookkeeping.
 *
 * Run it with:
 *   pnpm test:integration -- shutdown
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Orckit } from '../../src/orchestrator/orchestrator.js';
import type { OrckitConfig } from '../../src/config/schema.js';
import { validateConfig } from '../../src/config/load.js';

function makeConfig(
  processes: Record<string, Record<string, unknown>>,
  extras?: Record<string, unknown>,
): OrckitConfig {
  return validateConfig({ project: 'shutdown-test', processes, ...extras });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Does this pid still exist? Signal 0 only probes, it never delivers. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll until the pid is gone, then assert it — kills are observed, not instant. */
async function expectDead(pid: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && alive(pid)) {
    await sleep(25);
  }
  expect(alive(pid)).toBe(false);
}

/** Resolves the first time `process:starting` fires for `name`. */
function onStarting(orckit: Orckit, name: string): Promise<void> {
  return new Promise((resolve) => {
    const handler = (n: string): void => {
      if (n !== name) return;
      orckit.off('process:starting', handler);
      resolve();
    };
    orckit.on('process:starting', handler);
  });
}

/** Resolves the first time any `hook:start` fires. */
function onFirstHook(orckit: Orckit): Promise<void> {
  return new Promise((resolve) => {
    orckit.once('hook:start', () => resolve());
  });
}

/** Poll `orckit.inspect(name).pid` until the child exists. */
async function waitForPid(orckit: Orckit, name: string, timeoutMs = 5000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = orckit.inspect(name).pid;
    if (pid != null) return pid;
    await sleep(20);
  }
  throw new Error(`"${name}" never got a pid`);
}

/** A local port number nothing is bound to (reserved, then released). */
function reserveFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

describe('shutdown and orphan prevention', () => {
  let orckit: Orckit | null = null;
  let tmpDir: string;

  afterEach(async () => {
    if (orckit) {
      try {
        await orckit.dispose();
      } catch {
        // already disposed / mid-teardown — nothing more to do
      }
      orckit = null;
    }
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  }, 20_000);

  function scratch(): string {
    tmpDir = mkdtempSync(join(tmpdir(), 'orckit-shutdown-'));
    return tmpDir;
  }

  it('kills an in-flight pre_start hook and never spawns the process behind it', async () => {
    // THE orphan bug: Ctrl-C during a long `pnpm install` pre_start hook. The
    // teardown used to complete while the hook was still running, and the spawn
    // queued behind the hook then landed on an already-disposed orchestrator.
    const dir = scratch();
    const marker = join(dir, 'spawned');
    orckit = new Orckit(
      makeConfig({
        slow: {
          command: `touch ${marker}; sleep 30`,
          ready: { type: 'log-pattern', pattern: 'never-matches', timeout_ms: 2000 },
          hooks: { pre_start: 'sleep 10' },
        },
      }),
    );

    const hookStarted = onFirstHook(orckit);
    const boot = orckit.start().catch(() => {
      // a shutdown-cancelled boot is not a failure we assert on here
    });
    await hookStarted;

    const t0 = Date.now();
    await orckit.dispose();
    const disposeMs = Date.now() - t0;
    await boot;

    // dispose must not sit out the remaining ~10s of the hook.
    expect(disposeMs).toBeLessThan(4000);
    // Generous beat: a leaked spawn would have happened long before this.
    await sleep(1500);
    expect(existsSync(marker)).toBe(false);
    expect(['starting', 'ready', 'running']).not.toContain(orckit.state('slow'));
  }, 20_000);

  it('spawns nothing once disposed — startTargets() and restart() reject', async () => {
    const dir = scratch();
    const marker = join(dir, 'spawned');
    orckit = new Orckit(
      makeConfig({
        a: {
          command: `touch ${marker}; echo up; sleep 30`,
          ready: { type: 'log-pattern', pattern: 'up', timeout_ms: 2000 },
        },
      }),
    );

    await orckit.dispose();

    await expect(orckit.startTargets(['a'])).rejects.toThrow(/shutting down/);
    await expect(orckit.restart(['a'])).rejects.toThrow(/shutting down/);
    await expect(orckit.start()).rejects.toThrow(/disposed/);

    await sleep(500);
    expect(existsSync(marker)).toBe(false);
    expect(orckit.state('a')).toBe('pending');
  });

  it('interrupts a health-check wait promptly and kills the child', async () => {
    // The process comes up but never satisfies its probe. dispose() must cancel
    // the wait through the startup's abort signal instead of blocking until the
    // ready timeout expires, and the child must not survive the cancellation.
    orckit = new Orckit(
      makeConfig({
        hang: {
          command: 'echo booting; sleep 30',
          ready: { type: 'log-pattern', pattern: 'NEVER_READY', timeout_ms: 10_000 },
        },
      }),
    );

    const boot = orckit.start().catch(() => {});
    const pid = await waitForPid(orckit, 'hang');

    const t0 = Date.now();
    await orckit.dispose();
    const disposeMs = Date.now() - t0;
    await boot;

    expect(disposeMs).toBeLessThan(5000); // NOT the full 10s ready timeout
    await expectDead(pid);
    expect(['starting', 'ready', 'running']).not.toContain(orckit.state('hang'));
  }, 20_000);

  it('still kills the process when its pre_stop hook fails', async () => {
    // One bad teardown hook must not abort the shutdown and strand every
    // process still inside its grace window.
    orckit = new Orckit(
      makeConfig({
        p: {
          command: 'echo up; sleep 30',
          ready: { type: 'log-pattern', pattern: 'up', timeout_ms: 5000 },
          hooks: { pre_stop: 'exit 1' },
        },
      }),
    );

    await orckit.start();
    const pid = await waitForPid(orckit, 'p');

    const hookFailures: string[] = [];
    orckit.on('hook:failed', (_n, hook) => hookFailures.push(hook));

    await expect(orckit.dispose()).resolves.toBeUndefined();

    expect(hookFailures).toContain('pre_stop');
    expect(orckit.state('p')).toBe('stopped');
    await expectDead(pid);
  }, 20_000);

  it('still kills the process when its post_stop hook fails', async () => {
    orckit = new Orckit(
      makeConfig({
        p: {
          command: 'echo up; sleep 30',
          ready: { type: 'log-pattern', pattern: 'up', timeout_ms: 5000 },
          hooks: { post_stop: 'exit 1' },
        },
      }),
    );

    await orckit.start();
    const pid = await waitForPid(orckit, 'p');

    const hookFailures: string[] = [];
    orckit.on('hook:failed', (_n, hook) => hookFailures.push(hook));

    await expect(orckit.dispose()).resolves.toBeUndefined();

    expect(hookFailures).toContain('post_stop');
    expect(orckit.state('p')).toBe('stopped');
    await expectDead(pid);
  }, 20_000);

  it('does not respawn a crash-looping restart: always process after dispose', async () => {
    const dir = scratch();
    const log = join(dir, 'spawns.log');
    orckit = new Orckit(
      makeConfig({
        looper: {
          command: `echo spawn >> ${log}; echo up; sleep 0.1; exit 1`,
          ready: { type: 'log-pattern', pattern: 'up', timeout_ms: 5000 },
          restart: 'always',
          restart_delay_ms: 50,
          max_retries: 50,
          manual_retry: true,
        },
      }),
    );

    let starts = 0;
    orckit.on('process:starting', () => starts++);
    const restarts: number[] = [];
    orckit.on('process:restarting', (_n, attempt) => restarts.push(attempt));

    await orckit.start();
    // Let the loop actually turn over a couple of times.
    for (let i = 0; i < 100 && restarts.length < 2; i++) await sleep(25);
    expect(restarts.length).toBeGreaterThanOrEqual(2);

    await orckit.dispose();
    const startsAtDispose = starts;
    const spawnsAtDispose = readFileSync(log, 'utf-8').trim().split('\n').length;

    // Well past several restart_delay_ms windows.
    await sleep(800);
    expect(starts).toBe(startsAtDispose);
    expect(readFileSync(log, 'utf-8').trim().split('\n').length).toBe(spawnsAtDispose);
    expect(['starting', 'ready', 'running']).not.toContain(orckit.state('looper'));
  }, 20_000);

  it('emergencyKill() reaps a running child', async () => {
    orckit = new Orckit(
      makeConfig({
        p: {
          command: 'echo up; sleep 30',
          ready: { type: 'log-pattern', pattern: 'up', timeout_ms: 5000 },
        },
      }),
    );

    await orckit.start();
    const pid = await waitForPid(orckit, 'p');
    expect(alive(pid)).toBe(true);

    orckit.emergencyKill(); // synchronous — the crash path can't await

    await expectDead(pid);
  }, 20_000);

  it('leaves nothing running when a multi-wave boot is interrupted', async () => {
    // Ctrl-C mid-boot: wave 1 is up, wave 2 is starting, wave 3 never ran. No
    // process may be left in an active state and no spawned pid may survive.
    const dir = scratch();
    const markerC = join(dir, 'c-spawned');
    const proc = (extra: Record<string, unknown>): Record<string, unknown> => ({
      command: 'echo up; sleep 30',
      ready: { type: 'log-pattern', pattern: 'up', timeout_ms: 10_000 },
      ...extra,
    });
    orckit = new Orckit(
      makeConfig({
        a: proc({}),
        b: proc({
          depends_on: ['a'],
          // never satisfies its probe, so the boot is still in flight when the
          // shutdown lands.
          ready: { type: 'log-pattern', pattern: 'NEVER_READY', timeout_ms: 10_000 },
        }),
        c: proc({ depends_on: ['b'], command: `touch ${markerC}; echo up; sleep 30` }),
      }),
    );

    // Sample live pids as they appear — inspect() clears the runner on teardown.
    const pids = new Set<number>();
    const sampler = setInterval(() => {
      for (const name of ['a', 'b', 'c']) {
        const pid = orckit?.inspect(name).pid;
        if (pid != null) pids.add(pid);
      }
    }, 20);

    const bStarting = onStarting(orckit, 'b');
    const boot = orckit.start().catch(() => {});
    await bStarting;
    await sleep(100); // let b's child actually spawn

    await orckit.dispose();
    await boot;
    clearInterval(sampler);

    for (const [name, state] of orckit.states()) {
      expect(['starting', 'ready', 'running'], `${name} is ${state}`).not.toContain(state);
    }
    expect(pids.size).toBeGreaterThanOrEqual(2); // a and b really did spawn
    for (const pid of pids) await expectDead(pid);
    expect(existsSync(markerC)).toBe(false); // wave 3 never ran
  }, 25_000);

  it('does not spawn a later wave when a shutdown lands between waves', async () => {
    // Same shape, but the interrupt lands while wave 1's health wait is still
    // running — the wave driver itself must observe the shutdown and stop.
    const dir = scratch();
    const markerB = join(dir, 'b-spawned');
    const unusedPort = await reserveFreePort();
    orckit = new Orckit(
      makeConfig({
        a: {
          command: 'echo up; sleep 30',
          // tcp probe against a port nothing binds: never ready, so wave 2 is
          // still queued behind it.
          ready: {
            type: 'tcp',
            host: '127.0.0.1',
            port: unusedPort,
            interval_ms: 50,
            timeout_ms: 10_000,
          },
        },
        b: {
          command: `touch ${markerB}; echo up; sleep 30`,
          depends_on: ['a'],
          ready: { type: 'log-pattern', pattern: 'up', timeout_ms: 5000 },
        },
      }),
    );

    const boot = orckit.start().catch(() => {});
    const pid = await waitForPid(orckit, 'a');
    await orckit.dispose();
    await boot;

    await sleep(500);
    expect(existsSync(markerB)).toBe(false);
    expect(orckit.state('b')).toBe('pending');
    await expectDead(pid);
  }, 25_000);
});
