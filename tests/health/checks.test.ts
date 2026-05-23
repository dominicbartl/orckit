import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createProbe } from '../../src/health/checks.js';

let httpServer: HttpServer | null = null;
let tcpServer: NetServer | null = null;

afterEach(async () => {
  if (httpServer) {
    await new Promise<void>((r) => httpServer!.close(() => r()));
    httpServer = null;
  }
  if (tcpServer) {
    await new Promise<void>((r) => tcpServer!.close(() => r()));
    tcpServer = null;
  }
});

async function startHttp(
  handler: (req: unknown, res: { statusCode: number; end: (body?: string) => void }) => void,
): Promise<number> {
  httpServer = createHttpServer((req, res) => handler(req, res));
  return new Promise<number>((resolve) => {
    httpServer!.listen(0, '127.0.0.1', () => {
      const addr = httpServer!.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

async function startTcp(): Promise<number> {
  tcpServer = createNetServer();
  return new Promise<number>((resolve) => {
    tcpServer!.listen(0, '127.0.0.1', () => {
      const addr = tcpServer!.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

describe('HttpProbe', () => {
  it('passes when server returns expected status', async () => {
    const port = await startHttp((_req, res) => {
      res.statusCode = 200;
      res.end('ok');
    });
    const probe = createProbe({
      type: 'http',
      url: `http://127.0.0.1:${port}/`,
      expected_status: 200,
      interval_ms: 100,
      timeout_ms: 1000,
    });
    expect(await probe.check()).toEqual({ ok: true });
  });

  it('fails when status mismatches', async () => {
    const port = await startHttp((_req, res) => {
      res.statusCode = 500;
      res.end();
    });
    const probe = createProbe({
      type: 'http',
      url: `http://127.0.0.1:${port}/`,
      expected_status: 200,
      interval_ms: 100,
      timeout_ms: 1000,
    });
    const result = await probe.check();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('500');
  });

  it('fails when unreachable', async () => {
    const probe = createProbe({
      type: 'http',
      url: 'http://127.0.0.1:1/',
      expected_status: 200,
      interval_ms: 100,
      timeout_ms: 1000,
    });
    expect((await probe.check()).ok).toBe(false);
  });
});

describe('TcpProbe', () => {
  it('passes when port accepts connections', async () => {
    const port = await startTcp();
    const probe = createProbe({
      type: 'tcp',
      host: '127.0.0.1',
      port,
      interval_ms: 100,
      timeout_ms: 1000,
    });
    expect(await probe.check()).toEqual({ ok: true });
  });

  it('fails when port is closed', async () => {
    const probe = createProbe({
      type: 'tcp',
      host: '127.0.0.1',
      port: 1,
      interval_ms: 100,
      timeout_ms: 1000,
    });
    expect((await probe.check()).ok).toBe(false);
  });
});

describe('LogPatternProbe', () => {
  it('initially not ready', async () => {
    const probe = createProbe({ type: 'log-pattern', pattern: 'ready', timeout_ms: 1000 });
    expect((await probe.check()).ok).toBe(false);
  });

  it('becomes ready after matching line', async () => {
    const probe = createProbe({
      type: 'log-pattern',
      pattern: 'server listening',
      timeout_ms: 1000,
    });
    probe.feedLine?.('starting...');
    expect((await probe.check()).ok).toBe(false);
    probe.feedLine?.('server listening on 3000');
    expect((await probe.check()).ok).toBe(true);
  });
});

describe('CustomProbe', () => {
  it('passes when command exits 0', async () => {
    const probe = createProbe({
      type: 'custom',
      command: 'true',
      interval_ms: 100,
      timeout_ms: 1000,
    });
    expect((await probe.check()).ok).toBe(true);
  });

  it('fails when command exits non-zero', async () => {
    const probe = createProbe({
      type: 'custom',
      command: 'false',
      interval_ms: 100,
      timeout_ms: 1000,
    });
    expect((await probe.check()).ok).toBe(false);
  });
});
