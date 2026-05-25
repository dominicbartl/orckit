import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachCliReporter } from '../../src/reporter/cli-reporter.js';
import type { Orckit } from '../../src/orchestrator/orchestrator.js';
import type { OutputLine } from '../../src/process/output.js';

function makeFakeOrckit(outputs: Map<string, OutputLine[]> = new Map()): EventEmitter & Orckit {
  const orckit = new EventEmitter() as unknown as EventEmitter & Orckit;
  // attachCliReporter only calls orckit.output() in onFailed; stub it here.
  (orckit as unknown as { output: Orckit['output'] }).output = (name, n) => {
    const all = outputs.get(name) ?? [];
    return typeof n === 'number' ? all.slice(-n) : all.slice();
  };
  return orckit;
}

function line(text: string, stream: 'stdout' | 'stderr' = 'stdout'): OutputLine {
  return { text, stream, timestamp: Date.now() };
}

describe('attachCliReporter — failure tail', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    logSpy?.mockRestore();
  });

  it('dumps the most recent output lines beneath a process:failed line', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const outputs = new Map<string, OutputLine[]>([
      [
        'api',
        [
          line('starting up'),
          line('loaded config'),
          line('Error: ECONNREFUSED 127.0.0.1:5432', 'stderr'),
          line('  at TCPConnectWrap.afterConnect', 'stderr'),
        ],
      ],
    ]);
    const orckit = makeFakeOrckit(outputs);
    attachCliReporter(orckit);

    orckit.emit('process:failed', 'api', new Error('crashed'));

    const calls = logSpy.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toContain('api failed');
    expect(calls[0]).toContain('crashed');
    // Each remaining call should be one indented tail line, in order.
    expect(calls.length).toBe(5);
    expect(calls[1]).toContain('starting up');
    expect(calls[2]).toContain('loaded config');
    expect(calls[3]).toContain('ECONNREFUSED');
    expect(calls[4]).toContain('TCPConnectWrap');
    for (const call of calls.slice(1)) {
      expect(call).toMatch(/^ {6}/); // indented at least 6 spaces
    }
  });

  it('respects failureTailLines: 0 (no dump)', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const outputs = new Map<string, OutputLine[]>([['api', [line('would have been dumped')]]]);
    const orckit = makeFakeOrckit(outputs);
    attachCliReporter(orckit, { failureTailLines: 0 });

    orckit.emit('process:failed', 'api', new Error('crashed'));

    const calls = logSpy.mock.calls.map((c) => c[0] as string);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('api failed');
    expect(calls.join('\n')).not.toContain('would have been dumped');
  });

  it('honors a custom failureTailLines count', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const outputs = new Map<string, OutputLine[]>([
      ['api', Array.from({ length: 20 }, (_, i) => line(`line ${i}`))],
    ]);
    const orckit = makeFakeOrckit(outputs);
    attachCliReporter(orckit, { failureTailLines: 3 });

    orckit.emit('process:failed', 'api');

    const calls = logSpy.mock.calls.map((c) => c[0] as string);
    // 1 failed line + 3 tail lines
    expect(calls.length).toBe(4);
    expect(calls[1]).toContain('line 17');
    expect(calls[2]).toContain('line 18');
    expect(calls[3]).toContain('line 19');
  });

  it('emits only the failed line when the buffer is empty', () => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const orckit = makeFakeOrckit();
    attachCliReporter(orckit);

    orckit.emit('process:failed', 'api', new Error('immediate crash'));

    const calls = logSpy.mock.calls.map((c) => c[0] as string);
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('api failed');
  });
});
