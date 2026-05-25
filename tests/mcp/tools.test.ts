import { describe, it, expect } from 'vitest';
import {
  buildStatus,
  buildErrors,
  buildLogs,
  formatStatusText,
  formatErrorsText,
  formatLogsText,
  type OrckitView,
} from '../../src/mcp/tools.js';
import { validateConfig } from '../../src/config/load.js';
import type { ProcessState } from '../../src/orchestrator/lifecycle.js';
import type { OutputLine } from '../../src/process/output.js';

function makeView(setup: {
  processes: Record<string, { manual_retry?: boolean }>;
  inspect: Record<
    string,
    { state: ProcessState; pid?: number | null; startedAt?: number | null; retries?: number }
  >;
  output?: Record<string, OutputLine[]>;
}): OrckitView {
  const config = validateConfig({
    project: 'test',
    processes: Object.fromEntries(
      Object.entries(setup.processes).map(([name, p]) => [
        name,
        { command: 'echo hi', manual_retry: p.manual_retry ?? false },
      ]),
    ),
  });
  const output = setup.output ?? {};
  return {
    config,
    inspect(name) {
      const info = setup.inspect[name];
      if (!info) throw new Error(`unknown process "${name}"`);
      return {
        state: info.state,
        pid: info.pid ?? null,
        startedAt: info.startedAt ?? null,
        retries: info.retries ?? 0,
      };
    },
    states() {
      return new Map(Object.entries(setup.inspect).map(([n, i]) => [n, i.state]));
    },
    output(name) {
      return output[name] ?? [];
    },
  };
}

describe('buildStatus', () => {
  it('returns one entry per configured process with current state', () => {
    const view = makeView({
      processes: { db: {}, api: { manual_retry: true } },
      inspect: {
        db: { state: 'running', pid: 1234, startedAt: Date.now() - 5000 },
        api: { state: 'failed', retries: 2 },
      },
    });

    const status = buildStatus(view);

    expect(status).toHaveLength(2);
    const db = status.find((s) => s.name === 'db')!;
    expect(db.state).toBe('running');
    expect(db.pid).toBe(1234);
    expect(db.uptimeMs).toBeGreaterThanOrEqual(5000);
    expect(db.manualRetry).toBe(false);
    const api = status.find((s) => s.name === 'api')!;
    expect(api.state).toBe('failed');
    expect(api.pid).toBeNull();
    expect(api.uptimeMs).toBeNull();
    expect(api.retries).toBe(2);
    expect(api.manualRetry).toBe(true);
  });
});

describe('buildErrors', () => {
  it('returns only failed processes with last error and recent stderr', () => {
    const view = makeView({
      processes: { db: {}, api: {} },
      inspect: {
        db: { state: 'running', pid: 1 },
        api: { state: 'failed' },
      },
      output: {
        api: [
          { text: 'starting api', stream: 'stdout', timestamp: 1 },
          { text: 'EADDRINUSE: port 3000', stream: 'stderr', timestamp: 2 },
          { text: 'crashed at line 42', stream: 'stderr', timestamp: 3 },
        ],
      },
    });
    const lastErrors = new Map([['api', 'exited (code 1)']]);

    const errs = buildErrors(view, lastErrors);

    expect(errs).toHaveLength(1);
    expect(errs[0].name).toBe('api');
    expect(errs[0].lastError).toBe('exited (code 1)');
    expect(errs[0].recentStderr.map((l) => l.text)).toEqual([
      'EADDRINUSE: port 3000',
      'crashed at line 42',
    ]);
  });

  it('returns null lastError when none was captured', () => {
    const view = makeView({
      processes: { db: {} },
      inspect: { db: { state: 'failed' } },
    });

    const errs = buildErrors(view, new Map());

    expect(errs[0].lastError).toBeNull();
    expect(errs[0].recentStderr).toEqual([]);
  });

  it('caps recent stderr at 50 lines', () => {
    const stderrLines: OutputLine[] = Array.from({ length: 80 }, (_, i) => ({
      text: `err ${i}`,
      stream: 'stderr',
      timestamp: i,
    }));
    const view = makeView({
      processes: { api: {} },
      inspect: { api: { state: 'failed' } },
      output: { api: stderrLines },
    });

    const errs = buildErrors(view, new Map());

    expect(errs[0].recentStderr).toHaveLength(50);
    expect(errs[0].recentStderr[0].text).toBe('err 30');
    expect(errs[0].recentStderr[49].text).toBe('err 79');
  });
});

describe('buildLogs', () => {
  const sampleOutput: OutputLine[] = [
    { text: 'a', stream: 'stdout', timestamp: 1 },
    { text: 'b-err', stream: 'stderr', timestamp: 2 },
    { text: 'c', stream: 'stdout', timestamp: 3 },
    { text: 'd-err', stream: 'stderr', timestamp: 4 },
  ];

  it('defaults to last 100 lines of all streams', () => {
    const view = makeView({
      processes: { api: {} },
      inspect: { api: { state: 'running' } },
      output: { api: sampleOutput },
    });

    const res = buildLogs(view, { name: 'api' });

    expect(res.lines).toHaveLength(4);
    expect(res.name).toBe('api');
    expect(res.state).toBe('running');
  });

  it('respects the lines argument', () => {
    const view = makeView({
      processes: { api: {} },
      inspect: { api: { state: 'running' } },
      output: { api: sampleOutput },
    });

    const res = buildLogs(view, { name: 'api', lines: 2 });

    expect(res.lines.map((l) => l.text)).toEqual(['c', 'd-err']);
  });

  it('clamps lines to [1, 1000]', () => {
    const view = makeView({
      processes: { api: {} },
      inspect: { api: { state: 'running' } },
      output: { api: sampleOutput },
    });

    expect(buildLogs(view, { name: 'api', lines: 0 }).lines).toHaveLength(1);
    expect(buildLogs(view, { name: 'api', lines: 5000 }).lines).toHaveLength(4);
  });

  it('filters by stream', () => {
    const view = makeView({
      processes: { api: {} },
      inspect: { api: { state: 'running' } },
      output: { api: sampleOutput },
    });

    expect(buildLogs(view, { name: 'api', stream: 'stderr' }).lines.map((l) => l.text)).toEqual([
      'b-err',
      'd-err',
    ]);
    expect(buildLogs(view, { name: 'api', stream: 'stdout' }).lines.map((l) => l.text)).toEqual([
      'a',
      'c',
    ]);
  });

  it('throws for unknown process name', () => {
    const view = makeView({
      processes: { api: {} },
      inspect: { api: { state: 'running' } },
    });

    expect(() => buildLogs(view, { name: 'nope' })).toThrow(/unknown process/);
  });
});

describe('formatters', () => {
  it('formatStatusText is human-readable and includes the counts summary', () => {
    const text = formatStatusText([
      {
        name: 'db',
        state: 'running',
        pid: 1234,
        startedAt: 0,
        uptimeMs: 5_000,
        retries: 0,
        manualRetry: false,
      },
      {
        name: 'api',
        state: 'failed',
        pid: null,
        startedAt: null,
        uptimeMs: null,
        retries: 2,
        manualRetry: true,
      },
    ]);

    expect(text).toMatch(/2 processes/);
    expect(text).toMatch(/db/);
    expect(text).toMatch(/api/);
    expect(text).toMatch(/pid 1234/);
    expect(text).toMatch(/retries 2/);
  });

  it('formatErrorsText says all healthy when no errors', () => {
    expect(formatErrorsText([])).toMatch(/no errors/);
  });

  it('formatErrorsText includes stderr lines when present', () => {
    const text = formatErrorsText([
      {
        name: 'api',
        state: 'failed',
        lastError: 'exited (code 1)',
        recentStderr: [{ timestamp: 1, text: 'boom' }],
      },
    ]);
    expect(text).toMatch(/api/);
    expect(text).toMatch(/exited \(code 1\)/);
    expect(text).toMatch(/boom/);
  });

  it('formatLogsText handles empty output', () => {
    const text = formatLogsText({ name: 'api', state: 'running', lines: [] });
    expect(text).toMatch(/no output/);
  });

  it('formatLogsText distinguishes stderr from stdout', () => {
    const text = formatLogsText({
      name: 'api',
      state: 'running',
      lines: [
        { timestamp: 1, stream: 'stdout', text: 'hello' },
        { timestamp: 2, stream: 'stderr', text: 'oops' },
      ],
    });
    expect(text).toMatch(/\| hello/);
    expect(text).toMatch(/! oops/);
  });
});
