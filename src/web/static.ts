import { createReadStream, statSync, existsSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Resolve the directory that holds the bundled web-ui assets at runtime.
 *
 * Layout when published (npm tarball):
 *   dist/web/server.js           ← this module compiled
 *   dist/web/static/index.html   ← copied by the cli package's prebuild step
 *
 * Layout in the source tree (pnpm dev):
 *   packages/web-ui/dist/index.html  ← built by `pnpm --filter @orckit/web-ui build`
 *   src/web/static.ts                ← this module
 *
 * We try the published layout first (sibling `static/` next to this file),
 * then fall back to the monorepo layout. If neither exists, callers should
 * skip serving the dashboard and continue without crashing — the user may
 * just not have built the UI yet.
 */
export function resolveStaticDir(): string | null {
  const thisDir = dirname(fileURLToPath(import.meta.url));

  const candidates = [join(thisDir, 'static'), resolve(thisDir, '../../packages/web-ui/dist')];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

/**
 * Serve a single static asset under `root`. Rejects path traversal, falls
 * back to `index.html` for paths that don't resolve to a file so the SPA
 * router owns navigation. Returns true if a response was sent.
 */
export async function serveStaticAsset(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
): Promise<boolean> {
  const url = req.url ?? '/';
  let pathname = url.split('?')[0]!;
  if (pathname === '/') pathname = '/index.html';

  // Normalize + reject ".." traversal.
  const safePath = resolve(root, '.' + pathname);
  if (!safePath.startsWith(root)) {
    res.statusCode = 403;
    res.end();
    return true;
  }

  const filePath = existsSync(safePath) ? safePath : join(root, 'index.html');
  const stat = (() => {
    try {
      return statSync(filePath);
    } catch {
      return null;
    }
  })();
  if (!stat || !stat.isFile()) {
    res.statusCode = 404;
    res.end();
    return true;
  }

  res.statusCode = 200;
  res.setHeader('content-type', MIME[extname(filePath)] ?? 'application/octet-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('content-length', String(stat.size));

  await new Promise<void>((resolveDone, reject) => {
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('end', () => resolveDone());
    stream.pipe(res);
  });
  return true;
}
