import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { attachLiveBootView } from '../../src/reporter/live-view.js';
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

function fakeOrckit(config: OrckitConfig, initialStates?: Map<string, ProcessState>): EventEmitter & Orckit {
  const orckit = new EventEmitter() as unknown as EventEmitter & Orckit;
  (orckit as unknown as { config: OrckitConfig }).config = config;
  const states = initialStates ?? new Map(Object.keys(config.processes).map((n) => [n, 'pending' as ProcessState]));
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

describe('attachLiveBootView', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null when the stream is not a TTY', () => {
    const orckit = fakeOrckit(configWith({ a: [] }));
    const stream = new FakeStream();
    (stream as { isTTY: boolean }).isTTY = false;
    const handle = attachLiveBootView(orckit, { stream: stream as unknown as NodeJS.WriteStream });
    expect(handle).toBeNull();
  });

  it('renders the initial graph on attach', () => {
    const orckit = fakeOrckit(configWith({ db: [], api: ['db'] }));
    const stream = new FakeStream();
    const handle = attachLiveBootView(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 0,
    })!;
    try {
      const out = stream.rendered();
      expect(out).toContain('Wave 1');
      expect(out).toContain('db');
      expect(out).toContain('api');
      expect(out).toContain('← db');
    } finally {
      handle.dispose();
    }
  });

  it('redraws with updated state when process events fire', () => {
    const orckit = fakeOrckit(configWith({ db: [] }));
    const stream = new FakeStream();
    const handle = attachLiveBootView(orckit, {
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
    } finally {
      handle.dispose();
    }
  });

  it('annotates failures with the elapsed time', () => {
    const orckit = fakeOrckit(configWith({ db: [] }));
    const stream = new FakeStream();
    const handle = attachLiveBootView(orckit, {
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
    } finally {
      handle.dispose();
    }
  });

  it('animates the spinner on each tick while something is starting', () => {
    vi.useFakeTimers();
    const orckit = fakeOrckit(configWith({ db: [] }));
    const stream = new FakeStream();
    const handle = attachLiveBootView(orckit, {
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

  it('does not redraw on tick when no process is starting', () => {
    vi.useFakeTimers();
    const orckit = fakeOrckit(configWith({ db: [] }), new Map([['db', 'ready']]));
    const stream = new FakeStream();
    const handle = attachLiveBootView(orckit, {
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

  it('printAbove writes content above the graph and redraws', () => {
    const orckit = fakeOrckit(configWith({ db: [] }));
    const stream = new FakeStream();
    const handle = attachLiveBootView(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 0,
    })!;
    try {
      stream.chunks.length = 0;
      handle.printAbove('  hello world');
      const out = stream.rendered();
      // The log line and the graph header should both appear.
      expect(out).toContain('hello world');
      expect(out).toContain('Wave 1');
      // The log should appear before the graph in the write sequence.
      expect(out.indexOf('hello world')).toBeLessThan(out.indexOf('Wave 1'));
    } finally {
      handle.dispose();
    }
  });

  it('printAbove falls through to a plain write after dispose', () => {
    const orckit = fakeOrckit(configWith({ db: [] }));
    const stream = new FakeStream();
    const handle = attachLiveBootView(orckit, {
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
    const handle = attachLiveBootView(orckit, {
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
    const handle = attachLiveBootView(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 0,
    })!;
    handle.dispose();
    expect(() => handle.dispose()).not.toThrow();
  });

  it('detaches event handlers on dispose', () => {
    const orckit = fakeOrckit(configWith({ db: [] }));
    const stream = new FakeStream();
    const handle = attachLiveBootView(orckit, {
      stream: stream as unknown as NodeJS.WriteStream,
      tickMs: 0,
    })!;
    expect(orckit.listenerCount('process:state')).toBeGreaterThan(0);
    handle.dispose();
    expect(orckit.listenerCount('process:state')).toBe(0);
    expect(orckit.listenerCount('process:ready')).toBe(0);
    expect(orckit.listenerCount('process:failed')).toBe(0);
  });
});
