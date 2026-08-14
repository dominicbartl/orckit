import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import type { Orckit } from '../orchestrator/orchestrator.js';
import { trackBuilds } from '../process/build-tracker.js';
import { buildSnapshot, recentOutput } from './snapshot.js';
import { streamOrckitEvents } from './events.js';
import { resolveStaticDir, serveStaticAsset } from './static.js';
import type { IdeLink } from './ide.js';

export interface WebUiServerOptions {
  /** Port to bind. Use 0 for an arbitrary free port. */
  port: number;
  /** Host to bind. Defaults to 127.0.0.1. */
  host?: string;
  /**
   * IDE deep-link descriptor. When set, file references in the dashboard's
   * logs and errors become IDE deep links (built-in server). Null disables it.
   */
  ide?: IdeLink | null;
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
  const ide = opts.ide ?? null;
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

  // Track the latest build status per process so reconnecting clients (and the
  // initial snapshot) see the current build state, not just live deltas. SSE
  // listeners, like the dashboard reporter, only observe *new* build events.
  // The shared tracker owns the event-stream → status reduction so the web and
  // MCP servers never drift on it.
  const { builds, buildErrors, dispose: disposeTracker } = trackBuilds(orckit);

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
      sendJson(res, 200, buildSnapshot(orckit, { lastErrors, builds, buildErrors, ide }));
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

    // Open a file in the user's IDE via its command-line launcher. The browser
    // can't shell out, so it POSTs here and orckit runs the launcher. Params:
    // ?file=<absolute>&line=<n>&column=<n>.
    if (method === 'POST' && path === '/api/open') {
      if (!ide) {
        sendJson(res, 400, { error: 'IDE linking is disabled (no .idea / ide.enabled: false)' });
        return;
      }
      const params = new URL(url, 'http://localhost').searchParams;
      const file = params.get('file');
      const line = params.get('line');
      const column = params.get('column');
      if (!file || !isAbsolute(file)) {
        sendJson(res, 400, { error: 'file query param must be an absolute path' });
        return;
      }
      if (!existsSync(file)) {
        sendJson(res, 404, { error: `file not found: ${file}` });
        return;
      }
      // Files inside the IDE project root open in the IDE; anything else (temp
      // files, paths outside the project) opens in the OS default application.
      const inProject = isUnderRoot(file, ide.root);
      try {
        if (inProject) await openInIde(ide.command, file, line, column);
        else await openWithDefaultApp(file);
        sendJson(res, 200, { ok: true, openedWith: inProject ? ide.command : 'default app' });
      } catch (err) {
        const what = inProject ? `IDE launcher "${ide.command}"` : 'the default application';
        sendJson(res, 502, { error: `couldn't open with ${what}: ${(err as Error).message}` });
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
    res.write(
      `data: ${JSON.stringify(buildSnapshot(orckit, { lastErrors, builds, buildErrors, ide }))}\n\n`,
    );
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
      disposeTracker();
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

/**
 * Open a file in the user's IDE by running its command-line launcher detached:
 *   <command> [--line N] [--column C] <file>
 * Args are passed as an array (no shell), so the browser-supplied `file` can't
 * inject a command.
 */
function openInIde(
  command: string,
  file: string,
  line: string | null,
  column: string | null,
): Promise<void> {
  const args: string[] = [];
  if (line && /^\d+$/.test(line)) args.push('--line', line);
  if (column && /^\d+$/.test(column)) args.push('--column', column);
  args.push(file);
  return spawnDetached(command, args);
}

/** Open a file in the OS default application (for files outside the project). */
function openWithDefaultApp(file: string): Promise<void> {
  const [command, args] = defaultOpenCommand(process.platform, file);
  return spawnDetached(command, args);
}

/**
 * The OS default-open command + args for a file. Exposed for unit testing.
 *   - macOS:   `open <file>`
 *   - Windows: `cmd /c start "" <file>`  (empty title arg avoids quoting issues)
 *   - other:   `xdg-open <file>`
 */
export function defaultOpenCommand(platform: NodeJS.Platform, file: string): [string, string[]] {
  if (platform === 'darwin') return ['open', [file]];
  if (platform === 'win32') return ['cmd', ['/c', 'start', '', file]];
  return ['xdg-open', [file]];
}

/**
 * True when `file` is the project `root` or sits inside it. Pure path math.
 * Exposed for unit testing.
 */
export function isUnderRoot(file: string, root: string): boolean {
  const rel = relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Spawn a detached child, resolving once it has spawned and rejecting if it
 * couldn't be launched (e.g. ENOENT — not on PATH).
 */
function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
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
