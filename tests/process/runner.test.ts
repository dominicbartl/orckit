import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { execa, type ResultPromise } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { Runner } from '../../src/process/runner.js';
import { isPortFree } from '../../src/util/port.js';
import type { ProcessConfig } from '../../src/config/schema.js';

/** Reserve and immediately release a free local port number to drive tests. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

interface Holder {
  proc: ResultPromise;
  pid: number;
}

/**
 * Spawn a child node process that binds `port`, resolving once it's listening.
 * The child is boxed in an object — an execa `ResultPromise` is itself a
 * thenable, so returning it bare from an async fn makes `await` unwrap it and
 * block on the child's *exit* (which never comes for a listener).
 */
async function holdPort(port: number): Promise<Holder> {
  // `process.execPath`, not `'node'` — execa's sanitized PATH under the vitest
  // worker doesn't resolve the bare `node` from nvm.
  const proc = execa(
    process.execPath,
    ['-e', `require('net').createServer().listen(${port},'127.0.0.1')`],
    { reject: false },
  );
  // Poll the port rather than the child's stdout — readiness is "the socket is
  // bound", which `isPortFree` observes directly and without buffering quirks.
  for (let i = 0; i < 100; i++) {
    if (!(await isPortFree(port))) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return { proc, pid: proc.pid! };
}

function baseConfig(overrides: Partial<ProcessConfig> = {}): ProcessConfig {
  return {
    command: 'true',
    type: 'bash',
    category: 'default',
    env: {},
    depends_on: [],
    restart: 'on-failure',
    restart_delay_ms: 0,
    max_retries: 0,
    buffer_size: 100,
    ...overrides,
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('Runner', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0)) await fn();
  });

  function track(runner: Runner): Runner {
    cleanups.push(async () => {
      if (runner.running) await runner.stop(2000);
    });
    return runner;
  }

  it('emits lines for stdout', async () => {
    const runner = track(new Runner('t', baseConfig({ command: 'printf "one\\ntwo\\n"' })));
    const lines: Array<[string, string]> = [];
    runner.on('line', (text, stream) => lines.push([text, stream]));
    runner.start();
    await new Promise<void>((resolve) => runner.once('exit', () => resolve()));
    expect(lines).toEqual([
      ['one', 'stdout'],
      ['two', 'stdout'],
    ]);
  });

  it('emits stderr lines', async () => {
    const runner = track(new Runner('t', baseConfig({ command: 'echo boom 1>&2' })));
    const lines: Array<[string, string]> = [];
    runner.on('line', (text, stream) => lines.push([text, stream]));
    runner.start();
    await new Promise<void>((resolve) => runner.once('exit', () => resolve()));
    expect(lines).toContainEqual(['boom', 'stderr']);
  });

  it('reports exit codes', async () => {
    const runner = track(new Runner('t', baseConfig({ command: 'exit 5' })));
    runner.start();
    const [code] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) =>
      runner.once('exit', (c, s) => resolve([c, s])),
    );
    expect(code).toBe(5);
    expect(runner.exitCode).toBe(5);
    expect(runner.running).toBe(false);
  });

  it('uses cwd when provided', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orckit-runner-'));
    const resolved = realpathSync(dir);
    cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
    const runner = track(new Runner('t', baseConfig({ command: 'pwd', cwd: dir })));
    const lines: string[] = [];
    runner.on('line', (text) => lines.push(text));
    runner.start();
    await new Promise<void>((resolve) => runner.once('exit', () => resolve()));
    expect(lines).toContain(resolved);
  });

  it('passes env vars', async () => {
    const runner = track(
      new Runner('t', baseConfig({ command: 'echo "$MY_VAR"', env: { MY_VAR: 'hello' } })),
    );
    const lines: string[] = [];
    runner.on('line', (text) => lines.push(text));
    runner.start();
    await new Promise<void>((resolve) => runner.once('exit', () => resolve()));
    expect(lines).toContain('hello');
  });

  it('stops a long-running process', async () => {
    const runner = track(new Runner('t', baseConfig({ command: 'sleep 30' })));
    runner.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(runner.running).toBe(true);
    await runner.stop(2000);
    expect(runner.running).toBe(false);
  });

  it('SIGKILLs after grace period', async () => {
    const runner = track(new Runner('t', baseConfig({ command: "trap '' TERM; sleep 30" })));
    runner.start();
    await new Promise((r) => setTimeout(r, 200));
    const start = Date.now();
    await runner.stop(500);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(runner.running).toBe(false);
  });

  it('emits a SIGTERM kill event on graceful stop', async () => {
    const runner = track(new Runner('t', baseConfig({ command: 'sleep 30' })));
    const signals: string[] = [];
    runner.on('kill', (signal) => signals.push(signal));
    runner.start();
    await new Promise((r) => setTimeout(r, 100));
    await runner.stop(2000);
    expect(signals).toEqual(['SIGTERM']);
  });

  it('emits a SIGKILL kill event when grace expires', async () => {
    const runner = track(new Runner('t', baseConfig({ command: "trap '' TERM; sleep 30" })));
    const signals: string[] = [];
    runner.on('kill', (signal) => signals.push(signal));
    runner.start();
    await new Promise((r) => setTimeout(r, 200));
    await runner.stop(300);
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('kills background descendants, not just the top process', async () => {
    // Mirrors the real failure: a launcher (pnpm/firebase/ng) spawns a
    // long-lived worker that holds a port, but the worker ends up reparented to
    // init (here via a double-fork: a subshell backgrounds the worker then
    // exits, orphaning it) while the leader stays alive. A ppid-walking
    // tree-kill can no longer reach the orphan, so its port stays bound on the
    // next boot. Signalling the whole process group still reaps it. We capture
    // the worker's pid and assert it is gone after stop().
    const runner = track(
      new Runner('t', baseConfig({ command: '( sleep 60 & echo "WORKER:$!"; ); sleep 60' })),
    );
    let workerPid: number | undefined;
    runner.on('line', (text) => {
      const m = text.match(/^WORKER:(\d+)$/);
      if (m) workerPid = Number(m[1]);
    });
    runner.start();
    await new Promise((r) => setTimeout(r, 200));
    expect(workerPid).toBeGreaterThan(0);
    expect(isAlive(workerPid!)).toBe(true);
    await runner.stop(2000);
    // Give the OS a beat to finish reaping the group.
    await new Promise((r) => setTimeout(r, 100));
    expect(isAlive(workerPid!)).toBe(false);
  });

  it('does not hang on a child that escapes the kill and holds stdio open', async () => {
    // Reproduces molzait's `set -m` scripts: a background job escapes into its
    // own process group (set -m) and reparents to init (the subshell exits), so
    // it survives both our group-kill and tree-kill while still holding the
    // inherited stdout pipe. execa's promise then never settles. stop() must
    // still return promptly via the bounded post-SIGKILL reap, not hang forever.
    const command = 'set -m; ( sleep 41 & echo "HOLDER:$!"; ); trap \'\' TERM; sleep 600';
    const runner = track(new Runner('t', baseConfig({ command })));
    let holderPid: number | undefined;
    runner.on('line', (text) => {
      const m = text.match(/^HOLDER:(\d+)$/);
      if (m) holderPid = Number(m[1]);
    });
    cleanups.push(async () => {
      if (holderPid) {
        try {
          process.kill(holderPid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    });
    runner.start();
    await new Promise((r) => setTimeout(r, 300));
    const start = Date.now();
    await runner.stop(400); // 400ms grace + ~2s reap bound
    const elapsed = Date.now() - start;
    expect(runner.running).toBe(false);
    // Without the bounded reap this waits on the 41s holder (or, like the real
    // redis-commander, forever). The reap keeps it to grace + ~2s.
    expect(elapsed).toBeLessThan(6000);
  });

  it('cannot be started twice', () => {
    const runner = track(new Runner('t', baseConfig({ command: 'sleep 5' })));
    runner.start();
    expect(() => runner.start()).toThrow(/already started/);
  });

  it('uses stop_command instead of SIGTERM when configured', async () => {
    // The child traps TERM so SIGTERM alone won't end it. The stop_command
    // writes a sentinel file the child polls — proving the stop_command path
    // actually fires (otherwise the grace timeout would SIGKILL and we'd
    // never see the sentinel).
    const dir = mkdtempSync(join(tmpdir(), 'orckit-stopcmd-'));
    cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
    const sentinel = join(dir, 'stop.flag');
    const runner = track(
      new Runner(
        't',
        baseConfig({
          command: `trap '' TERM; while [ ! -f "${sentinel}" ]; do sleep 0.05; done; echo "stopped-cleanly"; exit 0`,
          stop_command: `touch "${sentinel}"`,
        }),
      ),
    );
    const lines: string[] = [];
    runner.on('line', (text) => lines.push(text));
    runner.start();
    await new Promise((r) => setTimeout(r, 150));
    const start = Date.now();
    await runner.stop(3000);
    expect(Date.now() - start).toBeLessThan(2000); // exited well before grace timeout
    expect(runner.running).toBe(false);
    expect(lines).toContain('stopped-cleanly');
  });

  it('falls back to SIGKILL when stop_command does not end the process', async () => {
    const runner = track(
      new Runner(
        't',
        baseConfig({
          command: "trap '' TERM; sleep 30",
          stop_command: 'true', // no-op
        }),
      ),
    );
    runner.start();
    await new Promise((r) => setTimeout(r, 150));
    const start = Date.now();
    await runner.stop(300);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(runner.running).toBe(false);
  });

  it('surfaces stop_command stderr through the runner line stream', async () => {
    const runner = track(
      new Runner(
        't',
        baseConfig({
          // The main process exits on its own once it sees the flag — keeps
          // the test fast without depending on grace-timeout escalation.
          command: 'sleep 30 &\npid=$!\ntrap "kill $pid 2>/dev/null" EXIT\nwait $pid',
          stop_command: 'echo "stop diag" >&2; sleep 0.05',
        }),
      ),
    );
    const stderrLines: string[] = [];
    runner.on('line', (text, stream) => {
      if (stream === 'stderr') stderrLines.push(text);
    });
    runner.start();
    await new Promise((r) => setTimeout(r, 150));
    // The stop_command is a no-op against the main process; the SIGKILL
    // fallback at the end of grace will end it. We just want to assert that
    // the stop_command's stderr was forwarded.
    await runner.stop(300);
    expect(stderrLines).toContain('stop diag');
  });

  it('sweeps orphaned ports after stop when kill_orphan_ports is set', async () => {
    // Model the escaped emulator: a holder that is NOT in the runner's process
    // tree keeps the port bound after the main process is stopped. The resource-
    // based sweep reclaims it by port, killing whatever still owns it.
    const port = await freePort();
    const orphan = await holdPort(port);
    cleanups.push(async () => {
      try {
        orphan.proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      await orphan.proc.catch(() => {});
    });
    const runner = track(
      new Runner('t', baseConfig({ command: 'sleep 30', ports: [port], kill_orphan_ports: true })),
    );
    const freed: Array<[number, number]> = [];
    runner.on('port_freed', (p, pid) => freed.push([p, pid]));
    runner.start();
    await new Promise((r) => setTimeout(r, 100));
    await runner.stop(2000);
    expect(freed).toContainEqual([port, orphan.pid]);
    await new Promise((r) => setTimeout(r, 100));
    expect(await isPortFree(port)).toBe(true);
  });

  it('infers the sweep port from a tcp ready check', async () => {
    const port = await freePort();
    const orphan = await holdPort(port);
    cleanups.push(async () => {
      try {
        orphan.proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      await orphan.proc.catch(() => {});
    });
    const runner = track(
      new Runner(
        't',
        baseConfig({
          command: 'sleep 30',
          kill_orphan_ports: true,
          ready: { type: 'tcp', host: 'localhost', port, interval_ms: 1000, timeout_ms: 60_000 },
        }),
      ),
    );
    const freed: number[] = [];
    runner.on('port_freed', (p) => freed.push(p));
    runner.start();
    await new Promise((r) => setTimeout(r, 100));
    await runner.stop(2000);
    expect(freed).toContain(port);
  });

  it('does not sweep ports when kill_orphan_ports is unset', async () => {
    const port = await freePort();
    const orphan = await holdPort(port);
    cleanups.push(async () => {
      try {
        orphan.proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      await orphan.proc.catch(() => {});
    });
    const runner = track(new Runner('t', baseConfig({ command: 'sleep 30', ports: [port] })));
    const freed: number[] = [];
    runner.on('port_freed', (p) => freed.push(p));
    runner.start();
    await new Promise((r) => setTimeout(r, 100));
    await runner.stop(2000);
    expect(freed).toEqual([]);
    // The orphan was never touched — the port is still bound.
    expect(await isPortFree(port)).toBe(false);
  });
});
