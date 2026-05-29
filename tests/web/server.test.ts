import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Orckit } from '../../src/orchestrator/orchestrator.js';
import { validateConfig } from '../../src/config/load.js';
import { attachWebUi, type WebUiServerHandle } from '../../src/web/server.js';

describe('attachWebUi over HTTP', () => {
  let orckit: Orckit;
  let server: WebUiServerHandle;

  beforeEach(async () => {
    const config = validateConfig({
      project: 'web-test',
      processes: {
        api: { command: 'sleep 1', restart: 'never' },
        worker: {
          command: 'sleep 1',
          restart: 'never',
          depends_on: ['api'],
          category: 'jobs',
        },
        tools: { command: 'sleep 1', restart: 'never', optional: true },
      },
    });
    orckit = new Orckit(config);
    server = await attachWebUi(orckit, { port: 0 });
  });

  afterEach(async () => {
    await server.dispose();
    await orckit.dispose();
  });

  it('GET /api/state returns a snapshot of every process', async () => {
    const res = await fetch(`${server.url}/api/state`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    const json = (await res.json()) as {
      project: string;
      processes: Array<{
        name: string;
        state: string;
        category: string;
        depends_on: string[];
        optional: boolean;
        pid: number | null;
      }>;
    };
    expect(json.project).toBe('web-test');
    const names = json.processes.map((p) => p.name).sort();
    expect(names).toEqual(['api', 'tools', 'worker']);

    const worker = json.processes.find((p) => p.name === 'worker')!;
    expect(worker.state).toBe('pending');
    expect(worker.category).toBe('jobs');
    expect(worker.depends_on).toEqual(['api']);
    expect(worker.pid).toBeNull();

    const tools = json.processes.find((p) => p.name === 'tools')!;
    expect(tools.optional).toBe(true);
  });

  it('GET /api/state surfaces the last error after a process:failed event', async () => {
    orckit.emit('process:failed', 'api', new Error('boom'));
    const res = await fetch(`${server.url}/api/state`);
    const json = (await res.json()) as {
      processes: Array<{ name: string; lastError?: string }>;
    };
    const api = json.processes.find((p) => p.name === 'api')!;
    expect(api.lastError).toBe('boom');
  });

  it('GET /api/state clears the last error after a process:ready event', async () => {
    orckit.emit('process:failed', 'api', new Error('boom'));
    orckit.emit('process:ready', 'api', 10);
    const res = await fetch(`${server.url}/api/state`);
    const json = (await res.json()) as {
      processes: Array<{ name: string; lastError?: string }>;
    };
    const api = json.processes.find((p) => p.name === 'api')!;
    expect(api.lastError).toBeUndefined();
  });

  it('GET /api/output/:name returns recent output lines', async () => {
    const handle = (
      orckit as unknown as {
        handles: Map<string, { buffer: { push(t: string, s: 'stdout' | 'stderr'): unknown } }>;
      }
    ).handles.get('api')!;
    handle.buffer.push('listening on 3000', 'stdout');
    handle.buffer.push('warning', 'stderr');

    const res = await fetch(`${server.url}/api/output/api`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { name: string; lines: Array<{ text: string }> };
    expect(json.name).toBe('api');
    expect(json.lines.map((l) => l.text)).toEqual(['listening on 3000', 'warning']);
  });

  it('GET /api/output/:name returns 404 for an unknown process', async () => {
    const res = await fetch(`${server.url}/api/output/nope`);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/unknown process/);
  });

  it('POST /api/restart/:name returns 400 for an unknown process', async () => {
    const res = await fetch(`${server.url}/api/restart/nope`, { method: 'POST' });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBeTruthy();
  });

  it('POST /api/stop/:name stops a known (idle) process', async () => {
    const res = await fetch(`${server.url}/api/stop/api`, { method: 'POST' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('POST /api/start/:name returns 400 for an unknown process', async () => {
    const res = await fetch(`${server.url}/api/start/nope`, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('OPTIONS returns 204 with CORS headers', async () => {
    const res = await fetch(`${server.url}/api/state`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    await res.arrayBuffer();
  });

  it('unknown /api/ route returns a JSON 404', async () => {
    const res = await fetch(`${server.url}/api/does-not-exist`);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/unknown api route/);
  });

  it('GET /events streams an initial snapshot then live events', async () => {
    const res = await fetch(`${server.url}/events`, {
      headers: { accept: 'text/event-stream' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const readUntil = async (predicate: (buf: string) => boolean): Promise<string> => {
      let buf = '';
      while (!predicate(buf)) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
      }
      return buf;
    };

    // First chunk carries the initial snapshot event.
    const snapshotBuf = await readUntil((b) => b.includes('event: snapshot'));
    expect(snapshotBuf).toContain('event: snapshot');
    expect(snapshotBuf).toContain('"project":"web-test"');

    // A subsequent emission flows through streamOrckitEvents → the socket.
    orckit.emit('process:ready', 'api', 42);
    const liveBuf = await readUntil((b) => b.includes('event: ready'));
    expect(liveBuf).toContain('event: ready');
    expect(liveBuf).toContain('"name":"api"');

    await reader.cancel();
  });

  it('rejects an EADDRINUSE bind with a clear message', async () => {
    await expect(attachWebUi(orckit, { port: server.port })).rejects.toThrow(/already in use/);
  });

  it('dispose detaches event listeners', async () => {
    const before = orckit.listenerCount('process:failed');
    const second = await attachWebUi(orckit, { port: 0 });
    expect(orckit.listenerCount('process:failed')).toBe(before + 1);
    await second.dispose();
    expect(orckit.listenerCount('process:failed')).toBe(before);
  });
});
