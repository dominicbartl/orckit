import { createServer, type Server } from 'node:net';
import { execa, type ResultPromise } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { findPortHolders, isPortFree, killPortHolders } from '../../src/util/port.js';

describe('isPortFree', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
  });

  it('returns true for a free port', async () => {
    expect(await isPortFree(0)).toBe(true);
  });

  it('returns false when port is occupied', async () => {
    const taken = await new Promise<number>((resolve) => {
      server = createServer();
      server.listen(0, '127.0.0.1', () => {
        const addr = server!.address();
        resolve(typeof addr === 'object' && addr ? addr.port : 0);
      });
    });
    expect(await isPortFree(taken)).toBe(false);
  });
});

/** Reserve and immediately release a free local port number to drive tests. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

interface Holder {
  proc: ResultPromise;
  pid: number;
}

/**
 * Spawn a child node process that binds `port`, resolving once it's listening.
 * The child is boxed in an object — an execa `ResultPromise` is itself a
 * thenable, so returning it bare from an async fn makes `await` unwrap it and
 * block on the child's *exit* (which never comes for a listener).
 */
async function holdPort(port: number): Promise<Holder> {
  // `process.execPath`, not `'node'` — execa's sanitized PATH under the vitest
  // worker doesn't resolve the bare `node` from nvm.
  const proc = execa(
    process.execPath,
    ['-e', `require('net').createServer().listen(${port},'127.0.0.1')`],
    { reject: false },
  );
  // Poll the port rather than the child's stdout — readiness is "the socket is
  // bound", which `isPortFree` observes directly and without buffering quirks.
  for (let i = 0; i < 100; i++) {
    if (!(await isPortFree(port))) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return { proc, pid: proc.pid! };
}

describe('findPortHolders / killPortHolders', () => {
  const holders: Holder[] = [];
  afterEach(async () => {
    for (const { proc } of holders.splice(0)) {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      await proc.catch(() => {});
    }
  });

  it('returns no holders for a free port', async () => {
    const port = await freePort();
    expect(await findPortHolders(port)).toEqual([]);
  });

  it('finds the pid holding a port', async () => {
    const port = await freePort();
    const holder = await holdPort(port);
    holders.push(holder);
    expect(await findPortHolders(port)).toContain(holder.pid);
  });

  it('force-kills whatever holds the port and frees it', async () => {
    const port = await freePort();
    const holder = await holdPort(port);
    holders.push(holder);
    const freed = await killPortHolders([port]);
    expect(freed).toContainEqual({ port, pid: holder.pid });
    await holder.proc.catch(() => {});
    // Give the kernel a beat to release the socket after the kill.
    await new Promise((r) => setTimeout(r, 100));
    expect(await isPortFree(port)).toBe(true);
  });

  it('reports nothing for ports with no holder', async () => {
    const port = await freePort();
    expect(await killPortHolders([port])).toEqual([]);
  });
});
