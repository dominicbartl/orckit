import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { attachShutdownReporter } from '../../src/reporter/shutdown-reporter.js';
import type { Orckit } from '../../src/orchestrator/orchestrator.js';
import type { OutputLine } from '../../src/process/output.js';

function makeFakeOrckit(): EventEmitter & Orckit {
  return new EventEmitter() as unknown as EventEmitter & Orckit;
}

function line(text: string, stream: 'stdout' | 'stderr' = 'stdout'): OutputLine {
  return { text, stream, timestamp: Date.now() };
}

describe('attachShutdownReporter', () => {
  it('logs stopping, then stopped with duration', () => {
    const captured: string[] = [];
    const orckit = makeFakeOrckit();
    attachShutdownReporter(orckit, { out: (m) => captured.push(m) });

    orckit.emit('process:stopping', 'db');
    orckit.emit('process:stopped', 'db', 120);

    expect(captured[0]).toContain('db');
    expect(captured[0]).toContain('stopping');
    expect(captured[1]).toContain('db');
    expect(captured[1]).toContain('stopped');
    expect(captured[1]).toContain('120ms');
  });

  it('flags a force-kill timeout and marks the eventual stop as forced', () => {
    const captured: string[] = [];
    const orckit = makeFakeOrckit();
    attachShutdownReporter(orckit, { out: (m) => captured.push(m) });

    orckit.emit('process:stopping', 'redis');
    orckit.emit('process:killed', 'redis', 'SIGTERM'); // graceful — no line
    orckit.emit('process:killed', 'redis', 'SIGKILL'); // timeout — loud line
    orckit.emit('process:stopped', 'redis', 10_100);

    const text = captured.join('\n');
    expect(text).toContain('did not exit in time');
    expect(text).toContain('SIGKILL');
    // only one extra line for the two killed events (SIGTERM stays silent)
    expect(captured.filter((l) => l.includes('SIGKILL'))).toHaveLength(1);
    const stoppedLine = captured.find((l) => l.includes('stopped'))!;
    expect(stoppedLine).toContain('forced');
  });

  it('surfaces a freed orphan port', () => {
    const captured: string[] = [];
    const orckit = makeFakeOrckit();
    attachShutdownReporter(orckit, { out: (m) => captured.push(m) });

    orckit.emit('process:port-freed', 'emulators', 8080, 54321);

    expect(captured[0]).toContain('emulators');
    expect(captured[0]).toContain('freed port 8080');
    expect(captured[0]).toContain('54321');
  });

  it('pipes process stdout/stderr indented and name-tagged', () => {
    const captured: string[] = [];
    const orckit = makeFakeOrckit();
    attachShutdownReporter(orckit, { out: (m) => captured.push(m) });

    orckit.emit('process:line', 'redis', line('Stopping Redis container...'));
    orckit.emit('process:line', 'redis', line('boom', 'stderr'));

    expect(captured[0]).toMatch(/^ {6}/); // piped output is indented deeper than status
    expect(captured[0]).toContain('redis');
    expect(captured[0]).toContain('Stopping Redis container...');
    expect(captured[1]).toContain('boom');
  });

  it('pipes hook output under a hook header', () => {
    const captured: string[] = [];
    const orckit = makeFakeOrckit();
    attachShutdownReporter(orckit, { out: (m) => captured.push(m) });

    orckit.emit('hook:start', 'api', 'pre_stop');
    orckit.emit('hook:line', 'api', 'pre_stop', 'draining connections', 'stdout');
    orckit.emit('hook:failed', 'api', 'pre_stop', new Error('drain timed out'));

    expect(captured[0]).toContain('api');
    expect(captured[0]).toContain('pre_stop hook');
    expect(captured[1]).toMatch(/^ {6}/);
    expect(captured[1]).toContain('draining connections');
    expect(captured[2]).toContain('pre_stop hook failed');
    expect(captured[2]).toContain('drain timed out');
  });

  it('reports a reaped orphan port', () => {
    const captured: string[] = [];
    const orckit = makeFakeOrckit();
    attachShutdownReporter(orckit, { out: (m) => captured.push(m) });

    orckit.emit('process:port-freed', 'emulators', 9099, 5555);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain('emulators');
    expect(captured[0]).toContain('9099');
    expect(captured[0]).toContain('5555');
  });

  it('detaches cleanly — no output after the returned dispose runs', () => {
    const captured: string[] = [];
    const orckit = makeFakeOrckit();
    const detach = attachShutdownReporter(orckit, { out: (m) => captured.push(m) });

    detach();
    orckit.emit('process:stopping', 'db');
    orckit.emit('process:stopped', 'db', 10);

    expect(captured).toEqual([]);
  });
});
