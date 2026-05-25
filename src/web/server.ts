import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { Orckit } from '../orchestrator/orchestrator.js';
import { buildSnapshot, recentOutput } from './snapshot.js';
import { streamOrckitEvents } from './events.js';
import { resolveStaticDir, serveStaticAsset } from './static.js';

export interface WebUiServerOptions {
  /** Port to bind. Use 0 for an arbitrary free port. */
  port: number;
  /** Host to bind. Defaults to 127.0.0.1. */
  host?: string;
}

export interface WebUiServerHandle {
  readonly url: string;
  readonly port: number;
  dispose(): Promise<void>;
}

/**
 * Attach an in-process web dashboard to an Orckit instance.
 *
 * Routes:
 *   GET  /                    → SPA shell (and any nested route via fallback)
 *   GET  /assets/*            → bundled JS/CSS/fonts
 *   GET  /api/state           → full snapshot (initial hydration)
 *   GET  /api/output/:name    → recent N lines from a process buffer
 *   GET  /events              → SSE stream of orckit events
 *   POST /api/restart/:name   → restart a process (cascade by default)
 *   POST /api/start/:name     → start a process (+ deps, skipping running ones)
 *   POST /api/stop/:name      → stop a process
 *
 * Follows the same shape as `attachMcpServer`: subscribes to events, returns
 * a handle whose `dispose()` cleanly shuts down the HTTP listener and
 * force-closes any open SSE sockets.
 */
export async function attachWebUi(
  orckit: Orckit,
  opts: WebUiServerOptions,
): Promise<WebUiServerHandle> {
  const host = opts.host ?? '127.0.0.1';
  const staticDir = resolveStaticDir();

  // Track last error per process so the initial snapshot can surface it
  // alongside the process state — SSE listeners only see *new* failures.
  const lastErrors = new Map<string, string>();
  const onFailed = (name: string, err?: Error) => {
    lastErrors.set(name, err?.message ?? 'process failed');
  };
  const onReady = (name: string) => {
    lastErrors.delete(name);
  };
  orckit.on('process:failed', onFailed);
  orckit.on('process:ready', onReady);

  const activeEventStreams = new Set<ServerResponse>();

  const http: HttpServer = createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: (err as Error).message }));
      } else {
        res.end();
      }
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = req.url ?? '/';
    const path = url.split('?')[0]!;
    const method = req.method ?? 'GET';

    if (method === 'GET' && path === '/api/state') {
      sendJson(res, 200, buildSnapshot(orckit, { lastErrors }));
      return;
    }

    if (method === 'GET' && path.startsWith('/api/output/')) {
      const name = decodeURIComponent(path.slice('/api/output/'.length));
      try {
        sendJson(res, 200, { name, lines: recentOutput(orckit, name) });
      } catch (err) {
        sendJson(res, 404, { error: (err as Error).message });
      }
      return;
    }

    if (method === 'GET' && path === '/events') {
      handleEventStream(req, res);
      return;
    }

    if (method === 'POST' && path.startsWith('/api/restart/')) {
      const name = decodeURIComponent(path.slice('/api/restart/'.length));
      try {
        await orckit.restart([name]);
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    if (method === 'POST' && path.startsWith('/api/start/')) {
      const name = decodeURIComponent(path.slice('/api/start/'.length));
      try {
        await orckit.startTargets([name]);
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    if (method === 'POST' && path.startsWith('/api/stop/')) {
      const name = decodeURIComponent(path.slice('/api/stop/'.length));
      try {
        await orckit.stop([name]);
        sendJson(res, 200, { ok: true });
      } catch (err) {
        sendJson(res, 400, { error: (err as Error).message });
      }
      return;
    }

    // CORS for the Vite dev server (port 5174) hitting the live orckit during
    // frontend development. In production both are same-origin so this is a
    // no-op for browser-served pages.
    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
      res.end();
      return;
    }

    // Don't fall through to the SPA shell for unmatched API routes — that'd
    // serve HTML to a JSON client and obscure the real 404.
    if (path.startsWith('/api/')) {
      sendJson(res, 404, { error: `unknown api route: ${path}` });
      return;
    }

    if (method === 'GET' && staticDir) {
      const served = await serveStaticAsset(req, res, staticDir);
      if (served) return;
    }

    if (!staticDir && method === 'GET' && path === '/') {
      sendJson(res, 503, {
        error:
          'web-ui static assets not found — build them with `pnpm --filter @orckit/web-ui build`',
      });
      return;
    }

    res.statusCode = 404;
    res.end();
  }

  function handleEventStream(_req: IncomingMessage, res: ServerResponse) {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    res.setHeader('access-control-allow-origin', '*');
    res.flushHeaders();

    activeEventStreams.add(res);
    const detach = streamOrckitEvents(orckit, res);

    const cleanup = () => {
      detach();
      activeEventStreams.delete(res);
    };
    res.on('close', cleanup);
    res.on('error', cleanup);

    // Initial snapshot as the first event so the client doesn't need a
    // separate /api/state fetch when it reconnects.
    res.write(`event: snapshot\n`);
    res.write(`data: ${JSON.stringify(buildSnapshot(orckit, { lastErrors }))}\n\n`);
  }

  await listen(http, opts.port, host);
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  const url = `http://${host}:${port}`;

  return {
    url,
    port,
    async dispose() {
      orckit.off('process:failed', onFailed);
      orckit.off('process:ready', onReady);
      for (const stream of activeEventStreams) {
        try {
          stream.end();
        } catch {
          // ignore — best-effort cleanup
        }
      }
      activeEventStreams.clear();
      await new Promise<void>((resolveClose, reject) => {
        http.close((err) => (err ? reject(err) : resolveClose()));
        // Force-close keep-alive sockets so close() doesn't hang on
        // long-lived event-stream consumers.
        http.closeAllConnections();
      });
    },
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('access-control-allow-origin', '*');
  res.end(JSON.stringify(body));
}

function listen(server: HttpServer, port: number, host: string): Promise<void> {
  return new Promise((resolveListen, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `port ${port} on ${host} is already in use — pass --web-port to choose another, ` +
              'or stop the other orckit',
          ),
        );
      } else {
        reject(err);
      }
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}
