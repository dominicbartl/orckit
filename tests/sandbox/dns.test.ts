import { describe, it, expect, afterEach, vi } from 'vitest';
import { createSocket } from 'node:dgram';
import type { AddressInfo } from 'node:net';
import {
  buildResponse,
  domainCache,
  handleQuery,
  HEALTH_ADDRESS,
  HEALTH_NAME,
  parseQuery,
  queryDns,
  RCODE,
  startDnsForwarder,
  startDnsStandby,
  testAlias,
  type DnsForwarderHandle,
  type DnsStandbyHandle,
  type QueryDeps,
} from '../../src/sandbox/dns.js';

/** A wire-format query, as `dig` would send it (RD set, optional EDNS OPT). */
function query(name: string, type = 1, opts: { id?: number; edns?: boolean } = {}): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(opts.id ?? 0x1234, 0);
  header.writeUInt16BE(0x0100, 2);
  header.writeUInt16BE(1, 4);
  if (opts.edns) header.writeUInt16BE(1, 10);
  const labels = name
    .split('.')
    .map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)]));
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(1, 2);
  const opt = opts.edns ? Buffer.from([0, 0, 41, 0x10, 0, 0, 0, 0, 0, 0, 0]) : Buffer.alloc(0);
  return Buffer.concat([header, ...labels, Buffer.from([0]), tail, opt]);
}

const rcode = (msg: Buffer) => msg.readUInt16BE(2) & 0xf;
const answers = (msg: Buffer) => msg.readUInt16BE(6);

const deps = (domains: string[], ips: Record<string, string[]> = {}): QueryDeps => ({
  isSandbox: async (name) => domains.includes(name),
  lookup: async (name) => ips[name] ?? [],
});

describe('testAlias', () => {
  it('maps a .local sandbox domain to .test', () => {
    expect(testAlias('feature-x.my-app.local')).toBe('feature-x.my-app.test');
    expect(testAlias('a.b.sandbox.local')).toBe('a.b.sandbox.test');
  });

  it('has no alias for domains outside .local', () => {
    expect(testAlias('feature-x.my-app.example')).toBeNull();
    expect(testAlias('localhost')).toBeNull();
  });
});

describe('parseQuery', () => {
  it('reads id, lowercased name, type and the verbatim question', () => {
    const q = parseQuery(query('Feature-X.App.TEST', 28, { id: 7, edns: true }))!;
    expect(q).toMatchObject({ id: 7, name: 'feature-x.app.test', type: 28, class: 1 });
    expect(q.question.toString('latin1')).toContain('Feature-X');
  });

  it('rejects responses, multi-question and truncated packets', () => {
    const response = query('a.test');
    response.writeUInt16BE(0x8100, 2);
    expect(parseQuery(response)).toBeNull();
    const two = query('a.test');
    two.writeUInt16BE(2, 4);
    expect(parseQuery(two)).toBeNull();
    expect(parseQuery(query('a.test').subarray(0, 16))).toBeNull();
    expect(parseQuery(Buffer.alloc(5))).toBeNull();
  });

  it('rejects compression pointers in the question name', () => {
    const msg = query('a.test');
    msg[12] = 0xc0;
    expect(parseQuery(msg)).toBeNull();
  });
});

describe('buildResponse', () => {
  it('echoes id, opcode, RD and question; sets QR + AA; appends A records', () => {
    const q = parseQuery(query('a.test', 1, { id: 0xbeef }))!;
    const res = buildResponse(q, RCODE.NOERROR, ['192.168.138.9']);
    expect(res.readUInt16BE(0)).toBe(0xbeef);
    expect(res.readUInt16BE(2)).toBe(0x8000 | 0x0400 | 0x0100);
    expect(answers(res)).toBe(1);
    expect(res.subarray(12, 12 + q.question.length)).toEqual(q.question);
    expect([...res.subarray(-4)]).toEqual([192, 168, 138, 9]);
  });
});

describe('negative answers', () => {
  const authority = (msg: Buffer) => msg.readUInt16BE(8);
  const q = () => parseQuery(query('a.test'))!;

  it('carry a test. SOA with a 1 s minimum, so a miss is not cached for long', () => {
    for (const res of [buildResponse(q(), RCODE.NXDOMAIN), buildResponse(q(), RCODE.NOERROR)]) {
      expect(authority(res)).toBe(1);
      const soa = res.subarray(12 + q().question.length);
      expect(soa.subarray(0, 6)).toEqual(Buffer.from('\x04test\x00', 'latin1'));
      expect(soa.readUInt16BE(6)).toBe(6); // SOA
      expect(soa.readUInt32BE(soa.length - 4)).toBe(1); // minimum
      expect(soa.readUInt16BE(14)).toBe(soa.length - 16); // rdlength
    }
  });

  it('positive and refused answers carry none', () => {
    expect(authority(buildResponse(q(), RCODE.NOERROR, ['10.0.0.1']))).toBe(0);
    expect(authority(buildResponse(q(), RCODE.REFUSED))).toBe(0);
  });
});

describe('handleQuery', () => {
  const sandbox = deps(['feature-x.app.local'], { 'feature-x.app.local': ['192.168.138.9'] });

  it('answers a running sandbox .test name with its .local address', async () => {
    const res = (await handleQuery(query('feature-x.app.test'), sandbox))!;
    expect(rcode(res)).toBe(RCODE.NOERROR);
    expect([...res.subarray(-4)]).toEqual([192, 168, 138, 9]);
  });

  it('is case-insensitive', async () => {
    const res = (await handleQuery(query('Feature-X.App.Test'), sandbox))!;
    expect(answers(res)).toBe(1);
  });

  it('answers AAAA for a sandbox with NODATA (IPv4 only), not NXDOMAIN', async () => {
    const res = (await handleQuery(query('feature-x.app.test', 28), sandbox))!;
    expect(rcode(res)).toBe(RCODE.NOERROR);
    expect(answers(res)).toBe(0);
  });

  it('is NXDOMAIN for .test names that are no running sandbox — without a lookup', async () => {
    const lookup = vi.fn(async () => ['10.0.0.5']);
    const res = (await handleQuery(query('printer.test'), { ...sandbox, lookup }))!;
    expect(rcode(res)).toBe(RCODE.NXDOMAIN);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('is NXDOMAIN when the sandbox is listed but does not resolve (yet)', async () => {
    const res = (await handleQuery(query('feature-x.app.test'), deps(['feature-x.app.local'])))!;
    expect(rcode(res)).toBe(RCODE.NXDOMAIN);
  });

  it('answers the zone apex with NODATA + SOA, not REFUSED', async () => {
    for (const type of [6, 2]) {
      const res = (await handleQuery(query('test', type), sandbox))!;
      expect(rcode(res)).toBe(RCODE.NOERROR);
      expect(res.readUInt16BE(8)).toBe(1);
    }
  });

  it('refuses names outside .test', async () => {
    const res = (await handleQuery(query('example.com'), sandbox))!;
    expect(rcode(res)).toBe(RCODE.REFUSED);
    expect(rcode((await handleQuery(query('feature-x.app.local'), sandbox))!)).toBe(RCODE.REFUSED);
  });

  it('answers the health name with its own address (not 127.0.0.1)', async () => {
    const res = (await handleQuery(query(HEALTH_NAME), deps([])))!;
    expect([...res.subarray(-4)].join('.')).toBe(HEALTH_ADDRESS);
  });

  it('is SERVFAIL when docker or the lookup fails', async () => {
    const broken: QueryDeps = {
      isSandbox: async () => {
        throw new Error('docker down');
      },
      lookup: async () => [],
    };
    expect(rcode((await handleQuery(query('a.test'), broken))!)).toBe(RCODE.SERVFAIL);
  });

  it('answers garbage with FORMERR and ignores responses', async () => {
    const garbage = query('a.test');
    garbage[12] = 0xc0;
    expect(rcode((await handleQuery(garbage, sandbox))!)).toBe(RCODE.FORMERR);
    const response = query('a.test');
    response.writeUInt16BE(0x8100, 2);
    expect(await handleQuery(response, sandbox)).toBeNull();
    expect(await handleQuery(Buffer.alloc(3), sandbox)).toBeNull();
  });
});

describe('domainCache', () => {
  it('reuses the list, and refreshes on a miss once the throttle passed', async () => {
    let t = 0;
    let domains = ['a.local'];
    const list = vi.fn(async () => domains);
    const has = domainCache(list, { maxAgeMs: 5000, missAgeMs: 500, now: () => t });

    expect(await has('a.local')).toBe(true);
    expect(await has('b.local')).toBe(false); // miss within throttle: no refresh
    expect(list).toHaveBeenCalledTimes(1);

    domains = ['a.local', 'b.local']; // a sandbox starts
    t = 600;
    expect(await has('b.local')).toBe(true); // miss past throttle: refreshed
    expect(list).toHaveBeenCalledTimes(2);
    expect(await has('a.local')).toBe(true);
    expect(list).toHaveBeenCalledTimes(2);

    domains = []; // everything stopped
    t = 6000;
    expect(await has('a.local')).toBe(false); // stale: refreshed before answering
  });

  it('shares one refresh between concurrent misses', async () => {
    const list = vi.fn(async () => ['a.local']);
    const has = domainCache(list);
    await Promise.all([has('x.local'), has('y.local'), has('a.local')]);
    expect(list).toHaveBeenCalledTimes(1);
  });
});

describe('startDnsForwarder + queryDns', () => {
  let forwarder: DnsForwarderHandle | null = null;
  afterEach(async () => {
    await forwarder?.dispose();
    forwarder = null;
  });

  it('serves sandbox names over UDP on 127.0.0.1', async () => {
    forwarder = await startDnsForwarder({
      port: 0,
      sandboxDomains: async () => ['wt1.app.local'],
      lookup: async () => ['192.168.138.9'],
    });
    expect(await queryDns(forwarder.port, 'wt1.app.test')).toEqual({
      rcode: RCODE.NOERROR,
      addresses: ['192.168.138.9'],
    });
    expect(await queryDns(forwarder.port, 'other.app.test')).toEqual({
      rcode: RCODE.NXDOMAIN,
      addresses: [],
    });
  });

  it('survives a lookup that finishes after dispose', async () => {
    let finish: (ips: string[]) => void = () => {};
    forwarder = await startDnsForwarder({
      port: 0,
      sandboxDomains: async () => ['wt1.app.local'],
      lookup: () => new Promise((resolve) => (finish = resolve)),
    });
    const pending = queryDns(forwarder.port, 'wt1.app.test', 300);
    await new Promise((resolve) => setTimeout(resolve, 50)); // query reached lookup
    await forwarder.dispose();
    forwarder = null;
    finish(['192.168.138.9']); // would throw ERR_SOCKET_DGRAM_NOT_RUNNING unguarded
    expect(await pending).toBeNull();
  });

  it('queryDns gives null when nothing answers', async () => {
    forwarder = await startDnsForwarder({
      port: 0,
      sandboxDomains: async () => [],
      lookup: async () => [],
    });
    const { port } = forwarder;
    await forwarder.dispose();
    forwarder = null;
    expect(await queryDns(port, HEALTH_NAME, 200)).toBeNull();
  });
});

/** A UDP port that was free a moment ago. */
async function freePort(): Promise<number> {
  const socket = createSocket('udp4');
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', () => resolve()));
  const { port } = socket.address() as AddressInfo;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}

describe('startDnsStandby', () => {
  const standbys: DnsStandbyHandle[] = [];
  afterEach(async () => {
    await Promise.all(standbys.splice(0).map((s) => s.dispose()));
  });
  const start = async (port: number, ip: string) => {
    const standby = await startDnsStandby({
      port,
      retryMs: 50,
      sandboxDomains: async () => ['wt1.app.local'],
      lookup: async () => [ip],
    });
    standbys.push(standby);
    return standby;
  };

  it('serves when the port is free; a second one stands by', async () => {
    const port = await freePort();
    const first = await start(port, '10.0.0.1');
    const second = await start(port, '10.0.0.2');
    expect(first.serving()).toBe(true);
    expect(second.serving()).toBe(false);
    expect((await queryDns(port, 'wt1.app.test'))?.addresses).toEqual(['10.0.0.1']);
  });

  it('takes over when the serving one exits', async () => {
    const port = await freePort();
    const first = await start(port, '10.0.0.1');
    const second = await start(port, '10.0.0.2');
    await first.dispose();
    await vi.waitFor(() => expect(second.serving()).toBe(true), { timeout: 1000 });
    expect((await queryDns(port, 'wt1.app.test'))?.addresses).toEqual(['10.0.0.2']);
  });

  it('stops retrying once disposed', async () => {
    const port = await freePort();
    const holder = await start(port, '10.0.0.1');
    const waiting = await start(port, '10.0.0.2');
    await waiting.dispose();
    await holder.dispose();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(waiting.serving()).toBe(false);
    expect(await queryDns(port, 'wt1.app.test', 200)).toBeNull();
  });
});
