import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Runner } from '../../src/process/runner.js';
import type { ProcessConfig } from '../../src/config/schema.js';

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
});
