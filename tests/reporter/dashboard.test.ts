import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { attachDashboard } from '../../src/reporter/dashboard.js';
import { stripAnsi } from '../../src/process/parsers.js';
import type { Orckit } from '../../src/orchestrator/orchestrator.js';
import type { OrckitConfig } from '../../src/config/schema.js';
import type { ProcessState } from '../../src/orchestrator/lifecycle.js';

function configWith(processes: Record<string, string[]>): OrckitConfig {
  const config: OrckitConfig = {
    project: 'live',
    processes: {} as Record<string, never>,
    preflight: [],
  };
  for (const [name, deps] of Object.entries(processes)) {
    (config.processes as Record<string, unknown>)[name] = {
      command: 'echo',
      type: 'bash',
      category: 'default',
      env: {},
      depends_on: deps,
      restart: 'on-failure',
      restart_delay_ms: 2000,
      max_retries: 3,
      buffer_size: 1000,
    };
  }
  return config;
}

function fakeOrckit(
  config: OrckitConfig,
  initialStates?: Map<string, ProcessState>,
): EventEmitter & Orckit {
  const orckit = new EventEmitter() as unknown as EventEmitter & Orckit;
  (orckit as unknown as { config: OrckitConfig }).config = config;
  const states =
    initialStates ??
    new Map(Object.keys(config.processes).map((n) => [n, 'pending' as ProcessState]));
  (orckit as unknown as { states: () => Map<string, ProcessState> }).states = () => new Map(states);
  return orckit;
}

class FakeStream extends EventEmitter {
  isTTY = true as const;
  chunks: string[] = [];
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  /** Joined output, with ANSI cursor + color codes stripped. */
  rendered(): string {
    return stripAnsi(this.chunks.join(''));
  }
}

describe('attachDashboard', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when the stream is not a TTY', () => {
    const orckit = fakeOrckit(configWith({ a: [] }));
    const stream = new FakeStream();
    (stream as { isTTY: boolean }).isTTY = false;
    const handle = attachDashboard(orckit, { stream: stream as unknown as NodeJS.WriteStream });
    expect(handle).toBeNull();
  });

  it('renders the brand header, graph, and footer on attach', () => {
    const orckit = fakeOrckit(configWith({ db: [], api: ['db'] }));
    const stream = new FakeStream();
    const handle = attachDashboard(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 0,
    })!;
    try {
      const out = stream.rendered();
      // Brand wordmark and project name
      expect(out).toContain('orckit');
      expect(out).toContain('live');
      // Dependency graph
      expect(out).toContain('Wave 1');
      expect(out).toContain('db');
      expect(out).toContain('api');
      expect(out).toContain('← db');
      // Footer counter
      expect(out).toMatch(/0\/2\s+ready/);
    } finally {
      handle.dispose();
    }
  });

  it('renders header links next to the brand mark', () => {
    const orckit = fakeOrckit(configWith({ db: [] }));
    const stream = new FakeStream();
    const handle = attachDashboard(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 0,
      links: [
        { label: 'web', value: 'http://127.0.0.1:7677' },
        { label: 'mcp', value: 'http://127.0.0.1:7676/mcp' },
      ],
    })!;
    try {
      const out = stream.rendered();
      expect(out).toContain('web');
      expect(out).toContain('http://127.0.0.1:7677');
      expect(out).toContain('mcp');
      expect(out).toContain('http://127.0.0.1:7676/mcp');
    } finally {
      handle.dispose();
    }
  });

  it('redraws with updated state when process events fire', () => {
    const orckit = fakeOrckit(configWith({ db: [] }));
    const stream = new FakeStream();
    const handle = attachDashboard(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 0,
    })!;
    try {
      stream.chunks.length = 0; // ignore initial paint

      orckit.emit('process:state', 'db', 'ready');
      orckit.emit('process:ready', 'db', 132);

      const out = stream.rendered();
      expect(out).toContain('✓ db');
      expect(out).toContain('(132ms)');
      expect(out).toMatch(/1\/1\s+ready/); // footer reflects the new state
    } finally {
      handle.dispose();
    }
  });

  it('annotates failures with the elapsed time and counts them in the footer', () => {
    const orckit = fakeOrckit(configWith({ db: [] }));
    const stream = new FakeStream();
    const handle = attachDashboard(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 0,
    })!;
    try {
      orckit.emit('process:starting', 'db');
      orckit.emit('process:state', 'db', 'starting');
      orckit.emit('process:state', 'db', 'failed');
      orckit.emit('process:failed', 'db', new Error('boom'));

      const out = stream.rendered();
      expect(out).toContain('✗ db');
      expect(out).toMatch(/failed/);
      expect(out).toMatch(/1\s+failed/);
    } finally {
      handle.dispose();
    }
  });

  it('renders build state next to processes that emit build events', () => {
    const orckit = fakeOrckit(configWith({ web: [] }), new Map([['web', 'running']]));
    const stream = new FakeStream();
    const handle = attachDashboard(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 0,
    })!;
    try {
      stream.chunks.length = 0;
      orckit.emit('process:build', 'web', { type: 'build:progress', percent: 67 });

      let out = stream.rendered();
      expect(out).toContain('building 67%');
      expect(out).toMatch(/1\s+building/); // footer counter

      stream.chunks.length = 0;
      orckit.emit('process:build', 'web', {
        type: 'build:complete',
        success: true,
        errors: 0,
        warnings: 0,
        durationMs: 1200,
      });

      out = stream.rendered();
      expect(out).toContain('built');
      expect(out).not.toContain('building');
    } finally {
      handle.dispose();
    }
  });

  it('animates the spinner on each tick while something is starting', () => {
    vi.useFakeTimers();
    const orckit = fakeOrckit(configWith({ db: [] }));
    const stream = new FakeStream();
    const handle = attachDashboard(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 80,
    })!;
    try {
      orckit.emit('process:state', 'db', 'starting');
      const before = stream.chunks.length;
      vi.advanceTimersByTime(240); // ~3 ticks
      const after = stream.chunks.length;
      expect(after).toBeGreaterThan(before);
    } finally {
      handle.dispose();
    }
  });

  it('also animates while a build is in progress', () => {
    vi.useFakeTimers();
    const orckit = fakeOrckit(configWith({ web: [] }), new Map([['web', 'running']]));
    const stream = new FakeStream();
    const handle = attachDashboard(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 80,
    })!;
    try {
      orckit.emit('process:build', 'web', { type: 'build:start' });
      const before = stream.chunks.length;
      vi.advanceTimersByTime(240);
      expect(stream.chunks.length).toBeGreaterThan(before);
    } finally {
      handle.dispose();
    }
  });

  it('does not redraw on tick when nothing is animating', () => {
    vi.useFakeTimers();
    const orckit = fakeOrckit(configWith({ db: [] }), new Map([['db', 'ready']]));
    const stream = new FakeStream();
    const handle = attachDashboard(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 80,
    })!;
    try {
      const before = stream.chunks.length;
      vi.advanceTimersByTime(800); // 10 ticks
      const after = stream.chunks.length;
      expect(after).toBe(before);
    } finally {
      handle.dispose();
    }
  });

  it('printAbove writes content above the live region and redraws', () => {
    const orckit = fakeOrckit(configWith({ db: [] }));
    const stream = new FakeStream();
    const handle = attachDashboard(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 0,
    })!;
    try {
      stream.chunks.length = 0;
      handle.printAbove('  hello world');
      const out = stream.rendered();
      expect(out).toContain('hello world');
      expect(out).toContain('Wave 1');
      expect(out.indexOf('hello world')).toBeLessThan(out.indexOf('Wave 1'));
    } finally {
      handle.dispose();
    }
  });

  it('printAbove falls through to a plain write after dispose', () => {
    const orckit = fakeOrckit(configWith({ db: [] }));
    const stream = new FakeStream();
    const handle = attachDashboard(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 0,
    })!;
    handle.dispose();
    stream.chunks.length = 0;
    handle.printAbove('post-dispose');
    expect(stream.rendered()).toBe('post-dispose\n');
  });

  it('restores the cursor on dispose', () => {
    const orckit = fakeOrckit(configWith({ db: [] }));
    const stream = new FakeStream();
    const handle = attachDashboard(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 0,
    })!;
    handle.dispose();
    const raw = stream.chunks.join('');
    expect(raw).toContain('\x1b[?25l'); // hide on attach
    expect(raw).toContain('\x1b[?25h'); // show on dispose
  });

  it('dispose is idempotent', () => {
    const orckit = fakeOrckit(configWith({ db: [] }));
    const stream = new FakeStream();
    const handle = attachDashboard(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 0,
    })!;
    handle.dispose();
    expect(() => handle.dispose()).not.toThrow();
  });

  it('detaches event handlers on dispose', () => {
    const orckit = fakeOrckit(configWith({ db: [] }));
    const stream = new FakeStream();
    const handle = attachDashboard(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 0,
    })!;
    expect(orckit.listenerCount('process:state')).toBeGreaterThan(0);
    expect(orckit.listenerCount('process:build')).toBeGreaterThan(0);
    handle.dispose();
    expect(orckit.listenerCount('process:state')).toBe(0);
    expect(orckit.listenerCount('process:ready')).toBe(0);
    expect(orckit.listenerCount('process:failed')).toBe(0);
    expect(orckit.listenerCount('process:build')).toBe(0);
  });
});
