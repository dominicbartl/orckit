import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isAbsolute } from 'node:path';
import type { IdeLink } from '../web/ide.js';
import { isUnderRoot, openFile } from '../web/open.js';

export interface OpenRelayHandle {
  /** URL the sandbox POSTs to (via OrbStack's `host.docker.internal`). */
  readonly url: string;
  dispose(): Promise<void>;
}

/**
 * Mac-side half of IDE links for a sandboxed run. The inner web dashboard
 * can't launch the Mac's IDE from a Linux container, so its `/api/open`
 * forwards here and this process — running on the Mac — opens the file.
 *
 * Listens on 127.0.0.1 only (OrbStack routes `host.docker.internal` to it) and
 * requires a per-session random token. The token is visible to everything in
 * the sandbox, so the relay only ever opens files inside the IDE project, in
 * the IDE: handing sandboxed code the OS default opener would let it `open` a
 * `.command`/`.app` it wrote to a shared mount — i.e. run code on the Mac.
 */
export async function startOpenRelay(ide: IdeLink): Promise<OpenRelayHandle> {
  const token = randomBytes(16).toString('hex');
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://relay');
      if (req.method !== 'POST' || url.pathname !== '/open') return send(res, 404, {});
      if (url.searchParams.get('token') !== token) return send(res, 403, { error: 'bad token' });
      const file = url.searchParams.get('file');
      if (!file || !isAbsolute(file)) return send(res, 400, { error: 'file must be absolute' });
      if (!isUnderRoot(file, ide.root)) {
        return send(res, 403, {
          error: `not opening ${file}: outside the IDE project ${ide.root}`,
        });
      }
      if (!existsSync(file)) return send(res, 404, { error: `file not found: ${file}` });
      try {
        const openedWith = await openFile(
          ide,
          file,
          url.searchParams.get('line'),
          url.searchParams.get('column'),
        );
        send(res, 200, { ok: true, openedWith });
      } catch (err) {
        send(res, 502, { error: `couldn't open ${file}: ${(err as Error).message}` });
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://host.docker.internal:${port}/open?token=${token}`,
    dispose: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}
