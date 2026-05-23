import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { isPortFree } from '../../src/util/port.js';

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
