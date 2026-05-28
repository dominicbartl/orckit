import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachCliReporter, printFailureDump } from '../../src/reporter/cli-reporter.js';
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

describe('attachCliReporter — hook activity', () => {
  it('announces hook:start and hook:failed (in plain and dashboard modes)', () => {
    const captured: string[] = [];
    const orckit = makeFakeOrckit();
    // quietProcessEvents mirrors how the dashboard attaches the reporter; hook
    // lines must still appear because the dashboard does not render them itself.
    attachCliReporter(orckit, { out: (m) => captured.push(m), quietProcessEvents: true });

    orckit.emit('hook:start', 'service', 'pre_start');
    orckit.emit('hook:failed', 'service', 'pre_start', new Error('npm install failed'));

    expect(captured[0]).toContain('service pre_start hook');
    expect(captured[1]).toContain('service pre_start hook failed');
    expect(captured[1]).toContain('npm install failed');
  });
});

describe('printFailureDump', () => {
  it('prints a header + error + tail block per failed process', () => {
    const outputs = new Map<string, OutputLine[]>([
      ['db', [line('listening on 5432'), line('ERR: shutting down', 'stderr')]],
      ['api', []],
    ]);
    const orckit = makeFakeOrckit(outputs);
    const errors = new Map([
      ['db', 'exited (code 1)'],
      ['api', 'spawn bash ENOENT'],
    ]);
    const captured: string[] = [];

    printFailureDump(orckit, ['db', 'api'], errors, { out: (m) => captured.push(m) });

    const text = captured.join('\n');
    expect(text).toMatch(/Logs for failed processes/);
    expect(text).toMatch(/── db /);
    expect(text).toContain('exited (code 1)');
    expect(text).toContain('listening on 5432');
    expect(text).toContain('ERR: shutting down');
    expect(text).toMatch(/── api /);
    expect(text).toContain('spawn bash ENOENT');
  });

  it('renders "(no output captured)" when there is neither error nor buffered output', () => {
    const orckit = makeFakeOrckit();
    const captured: string[] = [];
    printFailureDump(orckit, ['ghost'], new Map(), { out: (m) => captured.push(m) });
    expect(captured.join('\n')).toContain('(no output captured)');
  });

  it('does nothing when the failed list is empty', () => {
    const captured: string[] = [];
    printFailureDump(makeFakeOrckit(), [], new Map(), { out: (m) => captured.push(m) });
    expect(captured).toEqual([]);
  });
});
