import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attachLogReporter } from '../../src/reporter/log-reporter.js';
import type { Orckit } from '../../src/orchestrator/orchestrator.js';
import type { OutputLine } from '../../src/process/output.js';

function makeFakeOrckit(): EventEmitter & Orckit {
  return new EventEmitter() as unknown as EventEmitter & Orckit;
}

function line(text: string, stream: 'stdout' | 'stderr' = 'stdout'): OutputLine {
  return { text, stream, timestamp: Date.now() };
}

describe('attachLogReporter', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orckit-logs-'));
  });

  afterEach(() => {
    // tmpdir cleanup is best-effort; we don't fail tests on it
  });

  it('creates the log directory if missing', () => {
    const orckit = makeFakeOrckit();
    const nested = join(dir, 'does-not-exist-yet', 'logs');
    const handle = attachLogReporter(orckit, { dir: nested });
    expect(existsSync(nested)).toBe(true);
    expect(handle.dir).toBe(nested);
    return handle.dispose();
  });

  it('writes a session header and lines to one file per process', async () => {
    const orckit = makeFakeOrckit();
    const handle = attachLogReporter(orckit, { dir });

    orckit.emit('process:starting', 'api');
    orckit.emit('process:line', 'api', line('hello'));
    orckit.emit('process:line', 'api', line('boom', 'stderr'));

    orckit.emit('process:starting', 'web');
    orckit.emit('process:line', 'web', line('serving'));

    await handle.dispose();

    const apiLog = readFileSync(handle.fileFor('api'), 'utf-8');
    const webLog = readFileSync(handle.fileFor('web'), 'utf-8');

    expect(apiLog).toContain('== api started');
    expect(apiLog).toContain('  hello');
    expect(apiLog).toContain('! boom');
    expect(apiLog).not.toContain('serving');

    expect(webLog).toContain('== web started');
    expect(webLog).toContain('  serving');
  });

  it('separates restart sessions with a fresh header', async () => {
    const orckit = makeFakeOrckit();
    const handle = attachLogReporter(orckit, { dir });

    orckit.emit('process:starting', 'api');
    orckit.emit('process:line', 'api', line('boot 1'));
    orckit.emit('process:failed', 'api', new Error('crashed'));
    orckit.emit('process:restarting', 'api', 1);
    orckit.emit('process:starting', 'api');
    orckit.emit('process:line', 'api', line('boot 2'));

    await handle.dispose();

    const content = readFileSync(handle.fileFor('api'), 'utf-8');
    const headerMatches = content.match(/== api started/g) ?? [];
    expect(headerMatches.length).toBe(2);
    expect(content).toContain('failed: crashed');
    expect(content.indexOf('boot 1')).toBeLessThan(content.indexOf('boot 2'));
  });

  it('writes a footer on stop', async () => {
    const orckit = makeFakeOrckit();
    const handle = attachLogReporter(orckit, { dir });

    orckit.emit('process:starting', 'api');
    orckit.emit('process:line', 'api', line('serving'));
    orckit.emit('process:stopped', 'api');

    await handle.dispose();

    const content = readFileSync(handle.fileFor('api'), 'utf-8');
    expect(content).toMatch(/-- .* stopped/);
  });

  it('writes a footer on finish (one-shot completion)', async () => {
    const orckit = makeFakeOrckit();
    const handle = attachLogReporter(orckit, { dir });

    orckit.emit('process:starting', 'migrate');
    orckit.emit('process:line', 'migrate', line('done'));
    orckit.emit('process:finished', 'migrate', 12);

    await handle.dispose();

    const content = readFileSync(handle.fileFor('migrate'), 'utf-8');
    expect(content).toMatch(/-- .* finished/);
  });

  it('appends to existing files across multiple attaches', async () => {
    const first = attachLogReporter(makeFakeOrckit(), { dir });
    const orckitA = makeFakeOrckit();
    const handleA = attachLogReporter(orckitA, { dir });
    orckitA.emit('process:starting', 'api');
    orckitA.emit('process:line', 'api', line('run-1'));
    await handleA.dispose();

    const orckitB = makeFakeOrckit();
    const handleB = attachLogReporter(orckitB, { dir });
    orckitB.emit('process:starting', 'api');
    orckitB.emit('process:line', 'api', line('run-2'));
    await handleB.dispose();
    await first.dispose();

    const content = readFileSync(handleA.fileFor('api'), 'utf-8');
    expect(content).toContain('run-1');
    expect(content).toContain('run-2');
    expect((content.match(/== api started/g) ?? []).length).toBe(2);
  });

  it('sanitizes unsafe filename characters', () => {
    const orckit = makeFakeOrckit();
    const handle = attachLogReporter(orckit, { dir });
    const path = handle.fileFor('api/web service');
    expect(path).toMatch(/api_web_service\.log$/);
    return handle.dispose();
  });

  it('stops writing after dispose', async () => {
    const orckit = makeFakeOrckit();
    const handle = attachLogReporter(orckit, { dir });

    orckit.emit('process:starting', 'api');
    orckit.emit('process:line', 'api', line('first'));
    await handle.dispose();

    orckit.emit('process:line', 'api', line('after-dispose'));

    const content = readFileSync(handle.fileFor('api'), 'utf-8');
    expect(content).toContain('first');
    expect(content).not.toContain('after-dispose');
  });
});
