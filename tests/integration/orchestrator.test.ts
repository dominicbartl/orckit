import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
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
  let server: HttpServer | null = null;

  afterEach(async () => {
    if (orckit) {
      await orckit.dispose();
      orckit = null;
    }
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = null;
    }
  });

  it('starts a single process via exit-code ready', async () => {
    orckit = new Orckit(
      makeConfig({
        hi: { command: 'echo hi', ready: { type: 'exit-code' } },
      }),
    );
    await orckit.start();
    expect(orckit.state('hi')).toBe('running');
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
    const port = await new Promise<number>((resolve) => {
      server = createHttpServer((_req, res) => {
        res.statusCode = 200;
        res.end('ok');
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server!.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });

    orckit = new Orckit(
      makeConfig({
        web: {
          command: 'sleep 5',
          ready: {
            type: 'http',
            url: `http://127.0.0.1:${port}/`,
            interval_ms: 100,
            timeout_ms: 3000,
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
    expect(orckit.state('base')).toBe('running');
    expect(orckit.state('leaf')).toBe('running');
    expect(orckit.state('other')).toBe('pending');
  });
});
