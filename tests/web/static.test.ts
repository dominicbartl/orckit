import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { serveStaticAsset, resolveStaticDir } from '../../src/web/static.js';

/**
 * Drive serveStaticAsset through a throwaway HTTP server so we exercise the
 * real request/response objects (status codes, headers, streamed bodies)
 * rather than mocking them.
 */
describe('serveStaticAsset', () => {
  let root: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'orckit-static-'));
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>shell</title>');
    writeFileSync(join(root, 'app.js'), 'console.log(1)');
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets', 'style.css'), 'body{}');
    writeFileSync(join(root, 'blob.bin'), 'binarydata');

    server = createServer((req, res) => {
      void serveStaticAsset(req, res, root).catch(() => {
        res.statusCode = 500;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });

  it('serves index.html for / with the html mime type', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toContain('shell');
  });

  it('serves a nested asset with the correct mime type', async () => {
    const res = await fetch(`${base}/assets/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(await res.text()).toBe('body{}');
  });

  it('serves a known extension and a file as application/javascript', async () => {
    const res = await fetch(`${base}/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/javascript; charset=utf-8');
  });

  it('falls back to octet-stream for unknown extensions', async () => {
    const res = await fetch(`${base}/blob.bin`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('falls back to index.html for unknown SPA routes', async () => {
    const res = await fetch(`${base}/some/deep/route`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('shell');
  });

  it('rejects path traversal with 403', async () => {
    // fetch normalizes `/../` away client-side, so call the handler directly
    // with a raw url that escapes the root.
    const stub = makeResStub();
    const served = await serveStaticAsset(
      { url: '/../../../etc/passwd' } as never,
      stub.res as never,
      root,
    );
    expect(served).toBe(true);
    expect(stub.statusCode).toBe(403);
  });

  it('returns 404 when the resolved path is a directory', async () => {
    // `/assets` resolves to an existing directory, not a file → 404.
    const stub = makeResStub();
    const served = await serveStaticAsset({ url: '/assets' } as never, stub.res as never, root);
    expect(served).toBe(true);
    expect(stub.statusCode).toBe(404);
  });
});

function makeResStub() {
  const headers: Record<string, string> = {};
  const state = {
    statusCode: 0,
    res: {
      get statusCode() {
        return state.statusCode;
      },
      set statusCode(v: number) {
        state.statusCode = v;
      },
      setHeader(k: string, v: string) {
        headers[k.toLowerCase()] = v;
      },
      end() {},
    },
  };
  return state;
}

describe('resolveStaticDir', () => {
  it('returns null or an existing dir without throwing', () => {
    // In CI the web-ui may or may not be built; either way this must not throw
    // and must return null or a string.
    const dir = resolveStaticDir();
    expect(dir === null || typeof dir === 'string').toBe(true);
  });
});
