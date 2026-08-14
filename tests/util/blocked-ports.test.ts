import { createServer } from 'node:net';
import { execa, type ResultPromise } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { validateConfig } from '../../src/config/load.js';
import type { OrckitConfig } from '../../src/config/schema.js';
import {
  collectExpectedPorts,
  findBlockedPorts,
  isContainerProxy,
} from '../../src/util/blocked-ports.js';
import { describePortHolders, freePort, isPortFree } from '../../src/util/port.js';

/** Config with orckit's own listeners off, so only process ports are collected. */
function makeConfig(
  processes: Record<string, Record<string, unknown>>,
  extras?: Record<string, unknown>,
): OrckitConfig {
  return validateConfig({
    project: 'test',
    processes,
    mcp: { enabled: false },
    web: { enabled: false },
    ...extras,
  });
}

describe('collectExpectedPorts', () => {
  it('collects the local endpoint of an http ready check', () => {
    const config = makeConfig({
      api: { command: 'x', ready: { type: 'http', url: 'http://127.0.0.1:4000/health' } },
    });
    expect(collectExpectedPorts(config, ['api'])).toEqual([
      { port: 4000, owner: 'api', source: 'ready-check', required: true },
    ]);
  });

  it('collects the local endpoint of a tcp ready check', () => {
    const config = makeConfig({
      db: { command: 'x', ready: { type: 'tcp', host: 'localhost', port: 5432 } },
    });
    expect(collectExpectedPorts(config, ['db'])).toEqual([
      { port: 5432, owner: 'db', source: 'ready-check', required: true },
    ]);
  });

  it('ignores ready checks pointing at a non-local host', () => {
    const config = makeConfig({
      remoteHttp: { command: 'x', ready: { type: 'http', url: 'http://api.example.com:8080/up' } },
      remoteTcp: { command: 'x', ready: { type: 'tcp', host: 'db.internal', port: 5432 } },
    });
    expect(collectExpectedPorts(config, ['remoteHttp', 'remoteTcp'])).toEqual([]);
  });

  it('ignores ready checks with no port at all', () => {
    const config = makeConfig({
      logger: { command: 'x', ready: { type: 'log-pattern', pattern: 'up' } },
      oneshot: { command: 'x', ready: { type: 'exit-code' } },
      bare: { command: 'x' },
    });
    expect(collectExpectedPorts(config, ['logger', 'oneshot', 'bare'])).toEqual([]);
  });

  it('collects declared ports', () => {
    const config = makeConfig({
      emu: { command: 'x', ports: [8080, 9099] },
    });
    expect(collectExpectedPorts(config, ['emu'])).toEqual([
      { port: 8080, owner: 'emu', source: 'ports', required: true },
      { port: 9099, owner: 'emu', source: 'ports', required: true },
    ]);
  });

  it('de-duplicates a port declared twice — the ready check wins', () => {
    const config = makeConfig({
      api: {
        command: 'x',
        ready: { type: 'tcp', host: '127.0.0.1', port: 4000 },
        ports: [4000, 4001],
      },
    });
    expect(collectExpectedPorts(config, ['api'])).toEqual([
      { port: 4000, owner: 'api', source: 'ready-check', required: true },
      { port: 4001, owner: 'api', source: 'ports', required: true },
    ]);
  });

  it('de-duplicates across processes — the first owner wins', () => {
    const config = makeConfig({
      first: { command: 'x', ports: [7000] },
      second: { command: 'x', ports: [7000] },
    });
    expect(collectExpectedPorts(config, ['first', 'second'])).toEqual([
      { port: 7000, owner: 'first', source: 'ports', required: true },
    ]);
  });

  it('only collects the named processes, and skips unknown names', () => {
    const config = makeConfig({
      a: { command: 'x', ports: [1111] },
      b: { command: 'x', ports: [2222] },
    });
    expect(collectExpectedPorts(config, ['a', 'nope'])).toEqual([
      { port: 1111, owner: 'a', source: 'ports', required: true },
    ]);
  });

  it('includes orckit’s own mcp and web ports', () => {
    const config = validateConfig({
      project: 'test',
      processes: { a: { command: 'x' } },
    });
    expect(collectExpectedPorts(config, ['a'])).toEqual([
      { port: 7676, owner: 'orckit', source: 'mcp', required: false },
      { port: 7677, owner: 'orckit', source: 'web', required: false },
    ]);
  });

  it('honors mcp.enabled / web.enabled false', () => {
    const noMcp = validateConfig({
      project: 'test',
      processes: { a: { command: 'x' } },
      mcp: { enabled: false },
    });
    expect(collectExpectedPorts(noMcp, ['a'])).toEqual([
      { port: 7677, owner: 'orckit', source: 'web', required: false },
    ]);

    const noWeb = validateConfig({
      project: 'test',
      processes: { a: { command: 'x' } },
      web: { enabled: false },
    });
    expect(collectExpectedPorts(noWeb, ['a'])).toEqual([
      { port: 7676, owner: 'orckit', source: 'mcp', required: false },
    ]);
  });

  it('a process port that collides with the mcp port keeps the process as owner', () => {
    const config = validateConfig({
      project: 'test',
      processes: { a: { command: 'x', ports: [7676] } },
      web: { enabled: false },
    });
    // ...and becomes required, because now a real process needs it.
    expect(collectExpectedPorts(config, ['a'])).toEqual([
      { port: 7676, owner: 'a', source: 'ports', required: true },
    ]);
  });

  it('marks only the process ports required — orckit’s own servers are optional', () => {
    // A busy mcp/web port must never abort a boot: the CLI already degrades
    // (warns and continues) when its own listeners can't bind, and the likeliest
    // holder is a second project's `orc start` that must not be killed for it.
    const config = validateConfig({
      project: 'test',
      processes: { api: { command: 'x', ports: [4000] } },
    });
    const byPort = new Map(collectExpectedPorts(config, ['api']).map((p) => [p.port, p.required]));
    expect(byPort.get(4000)).toBe(true);
    expect(byPort.get(7676)).toBe(false);
    expect(byPort.get(7677)).toBe(false);
  });
});

describe('isContainerProxy', () => {
  it.each([
    'com.docker.backend',
    '/usr/bin/docker-proxy -proto tcp -host-port 5432',
    '/usr/bin/dockerd --host=unix:///var/run/docker.sock',
    '/Applications/OrbStack.app/Contents/MacOS/OrbStack',
    'colima --profile default',
    '/usr/local/bin/vpnkit --ethernet',
    'qemu-system-aarch64 -M lima',
  ])('matches container-platform proxy %s', (command) => {
    expect(isContainerProxy(command)).toBe(true);
  });

  it.each([
    'node /Users/dev/app/server.js',
    'java -jar firebase-emulator.jar --port 8080',
    '/bin/bash -c npm run dev',
    'python3 -m http.server 8000',
    'nginx: master process /usr/sbin/nginx',
  ])('does not match ordinary process %s', (command) => {
    expect(isContainerProxy(command)).toBe(false);
  });
});

/** A local port number nothing is bound to (reserved, then released). */
function reserveFreePort(): Promise<number> {
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
 * A listener opened in THIS process would be invisible to the sweep — the lsof
 * lookup filters out the orchestrator's own pid on purpose — so the holder has
 * to be a real, separate process. It's still test-owned, so killing it is safe.
 */
async function holdPort(port: number): Promise<Holder> {
  // `process.execPath`, not `'node'` — execa's sanitized PATH under the vitest
  // worker doesn't resolve the bare `node` from nvm.
  const proc = execa(
    process.execPath,
    ['-e', `require('net').createServer().listen(${port},'127.0.0.1')`],
    { reject: false },
  );
  for (let i = 0; i < 100; i++) {
    if (!(await isPortFree(port))) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return { proc, pid: proc.pid! };
}

describe('findBlockedPorts / describePortHolders / freePort', () => {
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

  it('reports nothing when every expected port is free', async () => {
    const port = await reserveFreePort();
    const expected = [{ port, owner: 'api', source: 'ready-check' as const }];
    expect(await findBlockedPorts(expected)).toEqual([]);
  });

  it('reports the expected port together with its holder', async () => {
    const port = await reserveFreePort();
    const holder = await holdPort(port);
    holders.push(holder);

    const blocked = await findBlockedPorts([{ port, owner: 'api', source: 'ready-check' }]);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({ port, owner: 'api', source: 'ready-check' });
    expect(blocked[0]!.holders.map((h) => h.pid)).toContain(holder.pid);
  });

  it('describes a holder with its pid, command and start time', async () => {
    const port = await reserveFreePort();
    const holder = await holdPort(port);
    holders.push(holder);

    const described = await describePortHolders(port);
    const mine = described.find((h) => h.pid === holder.pid);
    expect(mine).toBeDefined();
    expect(mine!.command).toContain('createServer');
    expect(mine!.startedAt).toBeTruthy();
  });

  it('describes nothing for a port with no listener', async () => {
    expect(await describePortHolders(await reserveFreePort())).toEqual([]);
  });

  it('freePort resolves true for a port nobody holds', async () => {
    const port = await reserveFreePort();
    // No holder => no signal is sent to anything; the fast path just confirms.
    expect(await freePort(port)).toBe(true);
  });
});
