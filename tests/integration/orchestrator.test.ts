import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Orckit } from '../../src/orchestrator/orchestrator.js';
import type { OrckitConfig } from '../../src/config/schema.js';
import { validateConfig } from '../../src/config/load.js';

function makeConfig(
  processes: Record<string, Record<string, unknown>>,
  extras?: Record<string, unknown>,
): OrckitConfig {
  return validateConfig({ project: 'test', processes, ...extras });
}

describe('Orckit end-to-end', () => {
  let orckit: Orckit | null = null;

  afterEach(async () => {
    if (orckit) {
      await orckit.dispose();
      orckit = null;
    }
  });

  it('starts a single process via exit-code ready (ends in finished)', async () => {
    orckit = new Orckit(
      makeConfig({
        hi: { command: 'echo hi', ready: { type: 'exit-code' } },
      }),
    );
    await orckit.start();
    expect(orckit.state('hi')).toBe('finished');
  });

  it('respects depends_on order', async () => {
    const order: string[] = [];
    orckit = new Orckit(
      makeConfig({
        db: { command: 'echo db', ready: { type: 'exit-code' } },
        api: { command: 'echo api', depends_on: ['db'], ready: { type: 'exit-code' } },
      }),
    );
    orckit.on('process:starting', (name) => order.push(name));
    await orckit.start();
    expect(order.indexOf('db')).toBeLessThan(order.indexOf('api'));
  });

  it('starts independent processes in parallel', async () => {
    const startTimes: Record<string, number> = {};
    orckit = new Orckit(
      makeConfig({
        a: { command: 'sleep 0.2', ready: { type: 'exit-code' } },
        b: { command: 'sleep 0.2', ready: { type: 'exit-code' } },
      }),
    );
    orckit.on('process:starting', (name) => {
      startTimes[name] = Date.now();
    });
    await orckit.start();
    expect(Math.abs(startTimes.a! - startTimes.b!)).toBeLessThan(100);
  });

  it('captures process output in the buffer', async () => {
    orckit = new Orckit(
      makeConfig({
        p: { command: 'printf "alpha\\nbeta\\n"', ready: { type: 'exit-code' } },
      }),
    );
    await orckit.start();
    const lines = orckit.output('p').map((l) => l.text);
    expect(lines).toContain('alpha');
    expect(lines).toContain('beta');
  });

  it('waits on an HTTP ready check', async () => {
    // Reserve a free port, then have the spawned process itself bind it —
    // that matches how the HTTP probe is used in practice (and how the
    // pre-spawn port-conflict guard expects the world to look).
    const port = await new Promise<number>((resolve) => {
      const reserve = createNetServer();
      reserve.listen(0, '127.0.0.1', () => {
        const addr = reserve.address();
        const p = typeof addr === 'object' && addr ? addr.port : 0;
        reserve.close(() => resolve(p));
      });
    });

    orckit = new Orckit(
      makeConfig({
        web: {
          // Tiny HTTP server in Node; sleeps a bit before binding so the probe
          // actually has to poll a few times.
          command: `node -e "setTimeout(()=>require('http').createServer((_,r)=>{r.statusCode=200;r.end('ok')}).listen(${port},'127.0.0.1'),250); setInterval(()=>{},1000)"`,
          ready: {
            type: 'http',
            url: `http://127.0.0.1:${port}/`,
            interval_ms: 100,
            timeout_ms: 5000,
          },
        },
      }),
    );
    await orckit.start();
    expect(orckit.state('web')).toBe('running');
  });

  it('waits on a log pattern', async () => {
    orckit = new Orckit(
      makeConfig({
        srv: {
          command: 'echo starting && sleep 0.2 && echo "READY: go" && sleep 2',
          ready: { type: 'log-pattern', pattern: 'READY', timeout_ms: 3000 },
        },
      }),
    );
    await orckit.start();
    expect(orckit.state('srv')).toBe('running');
  });

  it('treats a clean exit (code 0) after ready as stopped, not failed', async () => {
    orckit = new Orckit(
      makeConfig({
        worker: {
          command: 'echo ready && sleep 0.1 && echo done',
          ready: { type: 'log-pattern', pattern: 'ready', timeout_ms: 3000 },
          restart: 'on-failure',
        },
      }),
    );
    const restarts: number[] = [];
    orckit.on('process:restarting', (_n, attempt) => restarts.push(attempt));
    await orckit.start();
    // Wait for the natural exit
    await new Promise((r) => setTimeout(r, 500));
    expect(orckit.state('worker')).toBe('stopped');
    expect(restarts).toEqual([]);
  });

  it('does not retry by default — restart is `never` unless opted in', async () => {
    // A process that crashes after reaching ready should NOT restart by
    // default. Opting into auto-retry is now a deliberate `restart: on-failure`
    // (or `always`) choice. This stops silent retry loops on a broken process
    // from spamming the terminal and obscuring the real error.
    orckit = new Orckit(
      makeConfig({
        crasher: {
          command: 'echo ready && sleep 0.1 && exit 1',
          ready: { type: 'log-pattern', pattern: 'ready', timeout_ms: 3000 },
          manual_retry: true, // so start() doesn't throw on the failure
        },
      }),
    );
    const restarts: number[] = [];
    orckit.on('process:restarting', (_n, attempt) => restarts.push(attempt));
    await orckit.start();
    // Wait longer than any default restart_delay would have allowed retries
    await new Promise((r) => setTimeout(r, 800));
    expect(orckit.state('crasher')).toBe('failed');
    expect(restarts).toEqual([]); // crucially: no auto-retry was scheduled
  });

  it('still restarts on clean exit under restart: always', async () => {
    orckit = new Orckit(
      makeConfig({
        worker: {
          command: 'echo ready && sleep 0.1',
          ready: { type: 'log-pattern', pattern: 'ready', timeout_ms: 3000 },
          restart: 'always',
          restart_delay_ms: 50,
          max_retries: 2,
        },
      }),
    );
    const restarts: number[] = [];
    orckit.on('process:restarting', (_n, attempt) => restarts.push(attempt));
    await orckit.start();
    // Wait long enough for the natural exits + restart attempts to play out
    await new Promise((r) => setTimeout(r, 1500));
    expect(restarts.length).toBeGreaterThanOrEqual(1);
  });

  it('still restarts on non-zero exit under restart: on-failure', async () => {
    orckit = new Orckit(
      makeConfig({
        crash: {
          command: 'echo ready && sleep 0.1 && exit 7',
          ready: { type: 'log-pattern', pattern: 'ready', timeout_ms: 3000 },
          restart: 'on-failure',
          restart_delay_ms: 50,
          max_retries: 2,
        },
      }),
    );
    const restarts: number[] = [];
    orckit.on('process:restarting', (_n, attempt) => restarts.push(attempt));
    await orckit.start();
    await new Promise((r) => setTimeout(r, 1500));
    expect(restarts.length).toBeGreaterThanOrEqual(1);
  });

  it('reports failure (BootFailedError) when the process exits during health check', async () => {
    orckit = new Orckit(
      makeConfig({
        flaky: {
          command: 'exit 1',
          ready: {
            type: 'http',
            url: 'http://127.0.0.1:1/',
            interval_ms: 100,
            timeout_ms: 5000,
          },
          restart: 'never',
        },
      }),
    );
    await expect(orckit.start()).rejects.toThrow(/boot failed/);
    expect(orckit.state('flaky')).toBe('failed');
  });

  it('with manual_retry: true, the same failure does not throw', async () => {
    orckit = new Orckit(
      makeConfig({
        flaky: {
          command: 'exit 1',
          ready: {
            type: 'http',
            url: 'http://127.0.0.1:1/',
            interval_ms: 100,
            timeout_ms: 5000,
          },
          restart: 'never',
          manual_retry: true,
        },
      }),
    );
    const summary = await orckit.start();
    expect(summary.failed).toEqual(['flaky']);
    expect(orckit.state('flaky')).toBe('failed');
  });

  it('runs preflight checks and aborts when one fails', async () => {
    orckit = new Orckit(
      makeConfig(
        { a: { command: 'echo a', ready: { type: 'exit-code' } } },
        { preflight: [{ name: 'bad', command: 'exit 1', on_fail: 'check thing' }] },
      ),
    );
    await expect(orckit.start()).rejects.toThrow(/preflight/);
  });

  it('runs pre_start and post_start hooks', async () => {
    const seen: string[] = [];
    orckit = new Orckit(
      makeConfig({
        p: {
          command: 'echo go',
          ready: { type: 'exit-code' },
          hooks: { pre_start: 'echo pre', post_start: 'echo post' },
        },
      }),
    );
    orckit.on('hook:complete', (name, hook) => seen.push(`${name}:${hook}`));
    await orckit.start();
    expect(seen).toContain('p:pre_start');
    expect(seen).toContain('p:post_start');
  });

  it('marks a process failed (not stuck pending) when its pre_start hook fails', async () => {
    orckit = new Orckit(
      makeConfig({
        p: {
          command: 'echo never-runs',
          ready: { type: 'exit-code' },
          hooks: { pre_start: 'exit 1' },
        },
      }),
    );
    const failed: string[] = [];
    orckit.on('process:failed', (name) => failed.push(name));
    // pre_start runs before the process leaves `pending`; a failure must surface
    // as a strict boot failure rather than silently leaving it pending.
    await expect(orckit.start()).rejects.toThrow(/boot failed/);
    expect(orckit.state('p')).toBe('failed');
    expect(failed).toContain('p');
  });

  it('honors a custom hook_timeout_ms (slow hook is killed and fails the boot)', async () => {
    orckit = new Orckit(
      makeConfig({
        p: {
          command: 'echo never-runs',
          ready: { type: 'exit-code' },
          hooks: { pre_start: 'sleep 5' },
          hook_timeout_ms: 200,
        },
      }),
    );
    await expect(orckit.start()).rejects.toThrow(/boot failed/);
    expect(orckit.state('p')).toBe('failed');
  });

  it('stops cleanly and reports stopped state', async () => {
    orckit = new Orckit(
      makeConfig({
        s: {
          command: 'sleep 10',
          ready: { type: 'log-pattern', pattern: '.', timeout_ms: 1000 },
        },
      }),
    );
    // process has no output, so log-pattern will time out; use a non-matching trick:
    orckit = new Orckit(
      makeConfig({
        s: { command: 'echo up && sleep 10', ready: { type: 'log-pattern', pattern: 'up' } },
      }),
    );
    await orckit.start();
    expect(orckit.state('s')).toBe('running');
    await orckit.stop();
    expect(orckit.state('s')).toBe('stopped');
  });

  it('starts only targeted processes plus their dependencies', async () => {
    orckit = new Orckit(
      makeConfig({
        base: { command: 'echo base', ready: { type: 'exit-code' } },
        leaf: { command: 'echo leaf', depends_on: ['base'], ready: { type: 'exit-code' } },
        other: { command: 'echo other', ready: { type: 'exit-code' } },
      }),
    );
    await orckit.start(['leaf']);
    expect(orckit.state('base')).toBe('finished');
    expect(orckit.state('leaf')).toBe('finished');
    expect(orckit.state('other')).toBe('pending');
  });

  it('emits process:finished (not process:running) for exit-code processes', async () => {
    orckit = new Orckit(
      makeConfig({
        one: { command: 'echo one', ready: { type: 'exit-code' } },
      }),
    );
    const events: Array<{ kind: string; name: string }> = [];
    orckit.on('process:running', (name) => events.push({ kind: 'running', name }));
    orckit.on('process:finished', (name) => events.push({ kind: 'finished', name }));
    await orckit.start();
    expect(events).toEqual([{ kind: 'finished', name: 'one' }]);
  });

  it('unblocks downstream long-running processes after an exit-code process finishes', async () => {
    orckit = new Orckit(
      makeConfig({
        migrate: { command: 'echo migrated', ready: { type: 'exit-code' } },
        api: {
          command: 'echo up && sleep 10',
          depends_on: ['migrate'],
          ready: { type: 'log-pattern', pattern: 'up' },
        },
      }),
    );
    await orckit.start();
    expect(orckit.state('migrate')).toBe('finished');
    expect(orckit.state('api')).toBe('running');
  });

  it('re-runs a finished process on manual restart', async () => {
    const startTimes: number[] = [];
    orckit = new Orckit(
      makeConfig({
        one: { command: 'echo one', ready: { type: 'exit-code' } },
      }),
    );
    orckit.on('process:starting', () => startTimes.push(Date.now()));
    await orckit.start();
    expect(orckit.state('one')).toBe('finished');
    await orckit.restart(['one']);
    expect(orckit.state('one')).toBe('finished');
    expect(startTimes.length).toBe(2);
  });

  it('fails fast when the ready-check port is already taken (no false "ready")', async () => {
    // Hold a port so the orckit process can't bind. Without the pre-spawn
    // guard, the TCP probe would immediately succeed against this stale
    // listener and the user would see "ready (Xms)" followed by a confusing
    // "failed" once the command itself dies trying to bind.
    const portHolder: NetServer = createNetServer();
    const port = await new Promise<number>((resolve) => {
      portHolder.listen(0, '127.0.0.1', () => {
        const addr = portHolder.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
    try {
      const readyEvents: string[] = [];
      const failedErrors: string[] = [];
      orckit = new Orckit(
        makeConfig({
          emu: {
            command: 'sleep 30',
            ready: { type: 'tcp', host: '127.0.0.1', port },
            restart: 'never',
            manual_retry: true, // keep start() from throwing so we can inspect
          },
        }),
      );
      orckit.on('process:ready', (n) => readyEvents.push(n));
      orckit.on('process:failed', (_n, err) => failedErrors.push(err?.message ?? ''));
      await orckit.start();
      expect(orckit.state('emu')).toBe('failed');
      expect(readyEvents).toEqual([]); // crucially: no false-positive ready event
      expect(failedErrors[0]).toMatch(/already in use/);
      expect(failedErrors[0]).toMatch(new RegExp(String(port)));
    } finally {
      await new Promise<void>((r) => portHolder.close(() => r()));
    }
  });

  it('boots normally when the ready-check port is free', async () => {
    // Sanity check: the pre-spawn guard does NOT regress the common case.
    // We use an HTTP server bound on the fly inside the spawned command to
    // satisfy a TCP probe — the port must be free when start() begins.
    const port = await new Promise<number>((resolve) => {
      const probe = createNetServer();
      probe.listen(0, '127.0.0.1', () => {
        const addr = probe.address();
        const p = typeof addr === 'object' && addr ? addr.port : 0;
        probe.close(() => resolve(p));
      });
    });
    orckit = new Orckit(
      makeConfig({
        svc: {
          command: `node -e "require('net').createServer().listen(${port}, '127.0.0.1', () => {}); setInterval(()=>{},1000)"`,
          ready: { type: 'tcp', host: '127.0.0.1', port, timeout_ms: 5000 },
        },
      }),
    );
    await orckit.start();
    expect(orckit.state('svc')).toBe('running');
  });
});
