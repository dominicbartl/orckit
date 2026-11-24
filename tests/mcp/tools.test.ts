import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  buildStatus,
  buildErrors,
  buildLogs,
  buildBuildStatus,
  buildBuildStatuses,
  waitForBuild,
  formatStatusText,
  formatErrorsText,
  formatLogsText,
  formatBuildStatusText,
  formatWaitForBuildText,
  type OrckitView,
  buildFunctionLogs,
  formatFunctionLogsText,
  type ParsedLogsView,
} from '../../src/mcp/tools.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFirebaseLogAssembler,
  type FirebaseLogBundle,
  type FirebaseLogEntry,
} from '../../src/logs/firebase.js';
import type { BuildTracker } from '../../src/process/build-tracker.js';
import type { BuildStatus } from '../../src/process/parsers.js';
import { validateConfig } from '../../src/config/load.js';
import type { ProcessState } from '../../src/orchestrator/lifecycle.js';
import type { OutputLine } from '../../src/process/output.js';

function makeBuildView(procs: Record<string, { type?: string; state?: ProcessState }>): OrckitView {
  const config = validateConfig({
    project: 'test',
    processes: Object.fromEntries(
      Object.entries(procs).map(([name, p]) => [name, { command: 'x', type: p.type ?? 'bash' }]),
    ),
  });
  return {
    config,
    inspect(name) {
      const p = procs[name];
      if (!p) throw new Error(`unknown process "${name}"`);
      return { state: p.state ?? 'running', pid: null, startedAt: null, retries: 0, url: null };
    },
    states() {
      return new Map(Object.entries(procs).map(([n, p]) => [n, p.state ?? 'running']));
    },
    output() {
      return [];
    },
  };
}

function makeTracker(
  builds: Record<string, BuildStatus> = {},
  buildErrors: Record<string, string[]> = {},
): BuildTracker {
  return {
    builds: new Map(Object.entries(builds)),
    buildErrors: new Map(Object.entries(buildErrors)),
    dispose() {},
  };
}

function makeView(setup: {
  processes: Record<string, { manual_retry?: boolean }>;
  inspect: Record<
    string,
    {
      state: ProcessState;
      pid?: number | null;
      startedAt?: number | null;
      retries?: number;
      url?: string | null;
    }
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
        url: info.url ?? null,
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

  it('reports each URL through publicUrl, and null when there is none', () => {
    const view = makeView({
      processes: { web: {}, db: {} },
      inspect: {
        web: { state: 'running', url: 'http://localhost:4200' },
        db: { state: 'running' },
      },
    });

    const status = buildStatus(view, (url) => url.replace('localhost', 'wt.app.test'));

    expect(status.find((s) => s.name === 'web')!.url).toBe('http://wt.app.test:4200');
    expect(status.find((s) => s.name === 'db')!.url).toBeNull();
    expect(formatStatusText(status)).toContain('http://wt.app.test:4200');
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

describe('buildBuildStatus', () => {
  it('reports the current build with diagnostics only when failed', () => {
    const view = makeBuildView({ web: { type: 'webpack' } });
    const tracker = makeTracker(
      { web: { phase: 'failed', reason: 'boom' } },
      { web: ['err one', 'err two'] },
    );

    const entry = buildBuildStatus(view, tracker, 'web');
    expect(entry.tracked).toBe(true);
    expect(entry.build).toEqual({ phase: 'failed', reason: 'boom' });
    expect(entry.diagnostics).toEqual(['err one', 'err two']);
  });

  it('does not leak diagnostics for a successful build', () => {
    const view = makeBuildView({ web: { type: 'webpack' } });
    const tracker = makeTracker({ web: { phase: 'done', success: true, errors: 0, warnings: 0 } });
    expect(buildBuildStatus(view, tracker, 'web').diagnostics).toEqual([]);
  });

  it('marks untracked process types and returns a null build', () => {
    const view = makeBuildView({ api: { type: 'bash' } });
    const entry = buildBuildStatus(view, makeTracker(), 'api');
    expect(entry.tracked).toBe(false);
    expect(entry.build).toBeNull();
  });

  it('throws for an unknown process', () => {
    const view = makeBuildView({ web: { type: 'webpack' } });
    expect(() => buildBuildStatus(view, makeTracker(), 'nope')).toThrow(/unknown process/);
  });
});

describe('buildBuildStatuses', () => {
  it('lists only parser-backed or already-built processes when no name is given', () => {
    const view = makeBuildView({
      web: { type: 'webpack' },
      api: { type: 'bash' },
      worker: { type: 'bash' },
    });
    // worker has a build status despite no parser (e.g. seeded elsewhere); api has neither.
    const tracker = makeTracker({
      worker: { phase: 'done', success: true, errors: 0, warnings: 0 },
    });

    const names = buildBuildStatuses(view, tracker)
      .map((e) => e.name)
      .sort();
    expect(names).toEqual(['web', 'worker']);
  });
});

describe('waitForBuild', () => {
  it('returns immediately for an already-settled build', async () => {
    const view = makeBuildView({ web: { type: 'webpack' } });
    const tracker = makeTracker({ web: { phase: 'done', success: true, errors: 0, warnings: 0 } });

    const result = await waitForBuild(view, new EventEmitter(), tracker, { name: 'web' });
    expect(result.waited).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.build?.phase).toBe('done');
  });

  it('returns immediately with diagnostics for an already-failed build', async () => {
    const view = makeBuildView({ web: { type: 'webpack' } });
    const tracker = makeTracker({ web: { phase: 'failed', reason: 'x' } }, { web: ['oops'] });

    const result = await waitForBuild(view, new EventEmitter(), tracker, { name: 'web' });
    expect(result.waited).toBe(false);
    expect(result.diagnostics).toEqual(['oops']);
  });

  it('returns immediately for an untracked process (nothing to wait for)', async () => {
    const view = makeBuildView({ api: { type: 'bash' } });
    const result = await waitForBuild(view, new EventEmitter(), makeTracker(), { name: 'api' });
    expect(result.waited).toBe(false);
    expect(result.tracked).toBe(false);
    expect(result.build).toBeNull();
  });

  it('blocks until an in-progress build completes', async () => {
    vi.useFakeTimers();
    try {
      const view = makeBuildView({ web: { type: 'webpack' } });
      const tracker = makeTracker({ web: { phase: 'building' } });
      const emitter = new EventEmitter();

      const p = waitForBuild(view, emitter, tracker, { name: 'web' });
      emitter.emit('process:build', 'web', {
        type: 'build:complete',
        success: true,
        errors: 0,
        warnings: 0,
      });
      await vi.advanceTimersByTimeAsync(800);
      const result = await p;

      expect(result.waited).toBe(true);
      expect(result.timedOut).toBe(false);
      expect(result.build).toMatchObject({ phase: 'done', success: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('collects a stream of failure diagnostics and settles after they stop', async () => {
    vi.useFakeTimers();
    try {
      const view = makeBuildView({ web: { type: 'angular' } });
      const tracker = makeTracker({ web: { phase: 'building' } });
      const emitter = new EventEmitter();

      const p = waitForBuild(view, emitter, tracker, { name: 'web' });
      emitter.emit('process:build', 'web', { type: 'build:failed', reason: 'TS1' });
      emitter.emit('process:build', 'web', { type: 'build:failed', reason: 'TS2' });
      await vi.advanceTimersByTimeAsync(800);
      const result = await p;

      expect(result.waited).toBe(true);
      expect(result.build?.phase).toBe('failed');
      expect(result.diagnostics).toEqual(['TS1', 'TS2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out when the build never settles', async () => {
    vi.useFakeTimers();
    try {
      const view = makeBuildView({ web: { type: 'webpack' } });
      const tracker = makeTracker({ web: { phase: 'building' } });

      const p = waitForBuild(view, new EventEmitter(), tracker, { name: 'web', timeoutMs: 1000 });
      await vi.advanceTimersByTimeAsync(1100);
      const result = await p;

      expect(result.timedOut).toBe(true);
      expect(result.waited).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('build formatters', () => {
  it('formatBuildStatusText summarizes each process', () => {
    const text = formatBuildStatusText([
      {
        name: 'web',
        state: 'running',
        tracked: true,
        build: { phase: 'building', percent: 42 },
        diagnostics: [],
      },
      {
        name: 'api',
        state: 'running',
        tracked: true,
        build: { phase: 'done', success: true, errors: 0, warnings: 0 },
        diagnostics: [],
      },
    ]);
    expect(text).toMatch(/web.*building 42%/);
    expect(text).toMatch(/api.*done/);
  });

  it('formatWaitForBuildText lists diagnostics on failure', () => {
    const text = formatWaitForBuildText({
      name: 'web',
      state: 'running',
      tracked: true,
      build: { phase: 'failed', reason: 'nope' },
      diagnostics: ['line one', 'line two'],
      waited: true,
      timedOut: false,
    });
    expect(text).toMatch(/failed/);
    expect(text).toMatch(/! line one/);
    expect(text).toMatch(/! line two/);
  });

  it('formatWaitForBuildText notes an immediate (no-wait) result', () => {
    const text = formatWaitForBuildText({
      name: 'web',
      state: 'running',
      tracked: true,
      build: { phase: 'done', success: true, errors: 0, warnings: 0 },
      diagnostics: [],
      waited: false,
      timedOut: false,
    });
    expect(text).toMatch(/already settled/);
  });
});

describe('get_function_logs', () => {
  const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/firebase-logging');
  /** Entries the real assembler makes of recorded fixtures, renumbered into one timeline. */
  const assembled = (...files: string[]): FirebaseLogEntry[] =>
    files
      .flatMap((f) => {
        const a = createFirebaseLogAssembler();
        const bundles = readFileSync(join(fixtures, f), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as FirebaseLogBundle);
        return [...bundles.flatMap((b) => a.push(b)), ...a.flush()];
      })
      .map((e, id) => ({ ...e, id }));

  const ENTRIES = assembled(
    'concurrent-burst-404.jsonl',
    'migration-with-stripe-error.jsonl',
    'structured-logger.synthetic.jsonl',
  );

  function view(
    processes: Record<string, FirebaseLogEntry[]> = { emulators: ENTRIES },
  ): ParsedLogsView {
    return {
      names: () => Object.keys(processes),
      state: (name) =>
        name in processes
          ? { source: 'firebase', state: 'connected', url: 'ws://127.0.0.1:4500' }
          : undefined,
      entries: (name, limit) => (processes[name] ?? []).slice(-(limit ?? Infinity)),
      generation: (name) => (name in processes ? 3 : 0),
    };
  }

  it('returns request logs by default — no executions or system lines', () => {
    const result = buildFunctionLogs(view(), {});
    expect(result).toMatchObject({ name: 'emulators', source: 'connected', generation: 3 });
    expect(result.total).toBe(ENTRIES.length);
    expect(result.entries.every((e) => e.kind === 'log')).toBe(true);
    expect(result.matched).toBe(ENTRIES.filter((e) => e.kind === 'log').length);
  });

  it('filters by handler substring and hands fields over as plain JSON', () => {
    const result = buildFunctionLogs(view(), { handler: 'widgetcontroller' });
    expect(result.matched).toBe(8);
    const first = result.entries[0]!;
    expect(first).toMatchObject({
      kind: 'log',
      function: 'europe-west1-api',
      handler: 'WidgetController.getBootstrapData',
      level: 'info',
      message: 'WidgetController.getBootstrapData executed',
      fields: {
        controller: 'WidgetController',
        method: 'GET',
        status: 404,
        pathParams: { restaurantId: expect.stringMatching(/^probe-\d$/) },
      },
    });
    expect(first.time).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('filters by function — full or short name — and status', () => {
    expect(buildFunctionLogs(view(), { function: 'api', status: '404' }).matched).toBe(8);
    expect(buildFunctionLogs(view(), { function: 'europe-west1-api', status: '4xx' }).matched).toBe(
      9,
    );
    expect(buildFunctionLogs(view(), { status: '5xx' }).matched).toBe(0);
    expect(buildFunctionLogs(view(), { function: 'orders' }).entries.map((e) => e.message)).toEqual(
      ['Order placed', 'Slow query', 'Payment failed Error: card_declined'],
    );
  });

  it('filters by minimum level and keeps the stack of errors', () => {
    const warn = buildFunctionLogs(view(), { level: 'warn' });
    expect(warn.entries.every((e) => e.level === 'warn' || e.level === 'error')).toBe(true);
    expect(warn.entries.filter((e) => e.context === 'AllExceptionsFilter')).toHaveLength(8);

    const errors = buildFunctionLogs(view(), { level: 'error' });
    const stripe = errors.entries.find((e) => e.message?.startsWith('Failed to add product tags'))!;
    expect(stripe.stack).toMatch(/^\s+at generateV1Error/);
    expect(stripe.fields).toMatchObject({ type: 'StripeInvalidRequestError', statusCode: 404 });
  });

  it('searches message, stack and fields', () => {
    expect(buildFunctionLogs(view(), { search: 'probe-3' }).matched).toBe(1);
    expect(buildFunctionLogs(view(), { search: 'GENERATEV1ERROR' }).matched).toBe(2);
    expect(buildFunctionLogs(view(), { search: 'resource_missing' }).matched).toBe(2);
  });

  it('includes executions and system lines on request', () => {
    const withExec = buildFunctionLogs(view(), {
      include_executions: true,
      function: 'api',
      limit: 500,
    });
    expect(withExec.entries.filter((e) => e.kind === 'execution')).toHaveLength(10);
    expect(withExec.entries.find((e) => e.kind === 'execution')!.durationMs).toBeGreaterThan(0);

    const system = assembled('startup.jsonl');
    const withSystem = buildFunctionLogs(view({ emulators: system }), { include_system: true });
    expect(withSystem.matched).toBe(system.length);
    expect(buildFunctionLogs(view({ emulators: system }), {}).matched).toBe(0);
  });

  it('brings emulator load errors along when asked for warnings or errors', () => {
    const system = assembled('startup.jsonl');
    const errors = buildFunctionLogs(view({ emulators: system }), { level: 'error' });
    expect(errors.matched).toBeGreaterThan(0);
    expect(errors.entries.every((e) => e.kind === 'system' && e.level === 'error')).toBe(true);
    expect(errors.entries.map((e) => e.message)).toContainEqual(
      expect.stringMatching(/^Failed to load function definition/),
    );
    // Multi-line messages (`Require stack:` …) stay inside their entry's block.
    const text = formatFunctionLogsText(errors);
    expect(text).toContain('Require stack:');
    expect(
      text
        .split('\n')
        .slice(1)
        .every((l) => l.startsWith('  ')),
    ).toBe(true);
    expect(
      buildFunctionLogs(view({ emulators: system }), { level: 'warn' }).matched,
    ).toBeGreaterThan(errors.matched);
    // Explicitly off still means off; info-level queries stay request logs only.
    expect(
      buildFunctionLogs(view({ emulators: system }), { level: 'error', include_system: false })
        .matched,
    ).toBe(0);
    expect(buildFunctionLogs(view({ emulators: system }), { level: 'info' }).matched).toBe(0);
  });

  it('returns the newest `limit` matches and says how many there were', () => {
    const result = buildFunctionLogs(view(), { handler: 'WidgetController', limit: 3 });
    expect(result.matched).toBe(8);
    expect(result.entries.map((e) => e.id)).toEqual(
      buildFunctionLogs(view(), { handler: 'WidgetController' })
        .entries.slice(-3)
        .map((e) => e.id),
    );
  });

  it('resolves the process: implicit with one source, required with several', () => {
    expect(() => buildFunctionLogs(view({}), {})).toThrow(/no process has parsed_logs/);
    const two = view({ a: ENTRIES, b: [] });
    expect(() => buildFunctionLogs(two, {})).toThrow(/pass name \(one of: a, b\)/);
    expect(buildFunctionLogs(two, { name: 'b' })).toMatchObject({ name: 'b', total: 0 });
    expect(() => buildFunctionLogs(two, { name: 'web' })).toThrow(/"web" has no parsed_logs/);
  });

  it('formats compact text lines with a capped stack', () => {
    const text = formatFunctionLogsText(
      buildFunctionLogs(view(), { level: 'error', include_executions: true }),
    );
    const [head, ...lines] = text.split('\n');
    expect(head).toMatch(/^emulators — parsed logs connected · \d+ of \d+ entries match$/);
    expect(lines.find((l) => l.includes('Failed to add product tags'))).toMatch(
      /^ {2}\d\d:\d\d:\d\d\.\d{3} ERROR core_v2-migrateHttp Failed to add product tags .*\{"type":"StripeInvalidRequestError"/,
    );
    // Four frames at most per entry in the text; the JSON keeps them all.
    expect(lines.filter((l) => l.startsWith('      at ')).length).toBeLessThanOrEqual(4 * 3);

    const empty = formatFunctionLogsText(
      buildFunctionLogs(view(), { search: 'nothing-like-this' }),
    );
    expect(empty).toMatch(/0 of \d+ entries match\n {2}\(no matching entries\)$/);
  });
});
