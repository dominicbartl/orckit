import { createSocket, type Socket } from 'node:dgram';
import { lookup } from 'node:dns/promises';
import type { AddressInfo } from 'node:net';

/**
 * `.test` names for sandboxes. OrbStack only serves custom container domains
 * under `.local` (via mDNS), and nothing on the Mac resolves `.test`. With
 * `/etc/resolver/test` pointing here (see `dns-resolver.ts`), this forwarder
 * answers `<x>.test` with the address of the sandbox at `<x>.local` — so
 * `feature-x.my-app.test` reaches the same container as `feature-x.my-app.local`.
 *
 * No daemon: the Mac-side `orc start` of every sandbox runs a
 * {@link startDnsStandby}. One of them holds the port and serves all running
 * sandboxes; the others retry the bind and take over when it exits.
 *
 * Only names of running orckit sandboxes are answered; everything else under
 * `.test` is NXDOMAIN. That keeps `.test` meaning "a local sandbox" (never a
 * printer or other `.local` device on the LAN) and makes misses instant
 * instead of waiting out mDNS's 5 s timeout.
 */

export const DNS_SUFFIX = 'test';
export const DEFAULT_DNS_PORT = 15353;
/** Seconds clients may cache an answer — short, a restarted sandbox gets a new IP. */
const TTL = 5;
/**
 * Always answered with {@link HEALTH_ADDRESS}, so `orc sandbox dns status` can
 * check the whole path (macOS resolver → `/etc/resolver/test` → this server)
 * through `getaddrinfo` without a running sandbox. The address is unusual on
 * purpose: a foreign wildcard `.test` resolver (Valet, puma-dev) answers
 * everything with 127.0.0.1 and must not pass for this one.
 */
export const HEALTH_NAME = `orckit-dns-check.${DNS_SUFFIX}`;
export const HEALTH_ADDRESS = '127.0.15.53';
/**
 * Negative answers carry an SOA whose minimum (RFC 2308) is this, so a name
 * looked up while its sandbox is still starting resolves right after.
 */
const NEGATIVE_TTL = 1;

const TYPE_A = 1;
const TYPE_SOA = 6;
const CLASS_IN = 1;
export const RCODE = { NOERROR: 0, FORMERR: 1, SERVFAIL: 2, NXDOMAIN: 3, REFUSED: 5 } as const;

/** `<x>.local` → `<x>.test`; null for domains OrbStack serves under another suffix. */
export function testAlias(domain: string): string | null {
  return domain.endsWith('.local') ? `${domain.slice(0, -'.local'.length)}.${DNS_SUFFIX}` : null;
}

export interface DnsQuery {
  id: number;
  /** Header flags of the query (opcode + RD are echoed back). */
  flags: number;
  /** Lowercased, without the trailing dot. */
  name: string;
  type: number;
  class: number;
  /** The question section as received (echoed verbatim, case included). */
  question: Buffer;
}

/**
 * Parse a standard query with exactly one question. Returns null for anything
 * else (responses, other opcodes, compression pointers in the name, truncated
 * packets) — {@link handleQuery} answers those with FORMERR when it can.
 */
export function parseQuery(msg: Buffer): DnsQuery | null {
  if (msg.length < 12) return null;
  const flags = msg.readUInt16BE(2);
  const isResponse = (flags & 0x8000) !== 0;
  const opcode = (flags >> 11) & 0xf;
  if (isResponse || opcode !== 0 || msg.readUInt16BE(4) !== 1) return null;

  const labels: string[] = [];
  let offset = 12;
  for (;;) {
    if (offset >= msg.length) return null;
    const len = msg[offset]!;
    offset += 1;
    if (len === 0) break;
    if (len > 63 || offset + len > msg.length) return null; // includes pointers (0xc0)
    labels.push(msg.toString('latin1', offset, offset + len));
    offset += len;
  }
  if (offset + 4 > msg.length || offset - 12 > 255) return null;
  return {
    id: msg.readUInt16BE(0),
    flags,
    name: labels.join('.').toLowerCase(),
    type: msg.readUInt16BE(offset),
    class: msg.readUInt16BE(offset + 2),
    question: msg.subarray(12, offset + 4),
  };
}

/**
 * A response to `query`: the echoed question plus one A record per address.
 * NXDOMAIN and NODATA (NOERROR without addresses) get the zone's SOA in the
 * authority section — without one, resolvers cache the miss for as long as
 * they like.
 */
export function buildResponse(query: DnsQuery, rcode: number, addresses: string[] = []): Buffer {
  const negative = rcode === RCODE.NXDOMAIN || (rcode === RCODE.NOERROR && addresses.length === 0);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(query.id, 0);
  // QR, the query's opcode, AA, the query's RD; RA stays clear (no recursion).
  header.writeUInt16BE(0x8000 | (query.flags & 0x7900) | 0x0400 | (rcode & 0xf), 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(addresses.length, 6);
  header.writeUInt16BE(negative ? 1 : 0, 8);
  const answers = addresses.map((address) => {
    const rr = Buffer.alloc(16);
    rr.writeUInt16BE(0xc00c, 0); // pointer to the question's name
    rr.writeUInt16BE(TYPE_A, 2);
    rr.writeUInt16BE(CLASS_IN, 4);
    rr.writeUInt32BE(TTL, 6);
    rr.writeUInt16BE(4, 10);
    address.split('.').forEach((octet, i) => rr.writeUInt8(Number(octet), 12 + i));
    return rr;
  });
  return Buffer.concat([header, query.question, ...answers, ...(negative ? [soaRecord()] : [])]);
}

/** Wire-format domain name (uncompressed). */
function encodeName(name: string): Buffer {
  return Buffer.concat([
    ...name
      .split('.')
      .map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])),
    Buffer.from([0]),
  ]);
}

/** `test. SOA localhost. hostmaster.localhost. 1 60 60 60 <NEGATIVE_TTL>` */
function soaRecord(): Buffer {
  const timers = Buffer.alloc(20);
  [1, 60, 60, 60, NEGATIVE_TTL].forEach((value, i) => timers.writeUInt32BE(value, i * 4));
  const rdata = Buffer.concat([
    encodeName('localhost'),
    encodeName('hostmaster.localhost'),
    timers,
  ]);
  const fixed = Buffer.alloc(10);
  fixed.writeUInt16BE(TYPE_SOA, 0);
  fixed.writeUInt16BE(CLASS_IN, 2);
  fixed.writeUInt32BE(NEGATIVE_TTL, 4);
  fixed.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([encodeName(DNS_SUFFIX), fixed, rdata]);
}

/** A bare FORMERR for a packet we couldn't parse but whose id we can echo. */
function formatError(msg: Buffer): Buffer | null {
  if (msg.length < 12 || (msg.readUInt16BE(2) & 0x8000) !== 0) return null;
  const header = Buffer.alloc(12);
  header.writeUInt16BE(msg.readUInt16BE(0), 0);
  header.writeUInt16BE(0x8000 | RCODE.FORMERR, 2);
  return header;
}

export interface QueryDeps {
  /** Whether a `.local` name belongs to a running sandbox. */
  isSandbox: (name: string) => Promise<boolean>;
  /** IPv4 addresses for a `.local` name (the macOS resolver → OrbStack). */
  lookup: (name: string) => Promise<string[]>;
}

/**
 * Answer one query packet. Pure apart from `deps`; null means "don't reply"
 * (the packet wasn't a query at all).
 */
export async function handleQuery(msg: Buffer, deps: QueryDeps): Promise<Buffer | null> {
  const query = parseQuery(msg);
  if (!query) return formatError(msg);
  const suffix = `.${DNS_SUFFIX}`;
  // The zone apex exists (resolvers probe it for SOA/NS); it just has no data here.
  if (query.class === CLASS_IN && query.name === DNS_SUFFIX) {
    return buildResponse(query, RCODE.NOERROR);
  }
  if (query.class !== CLASS_IN || !query.name.endsWith(suffix)) {
    return buildResponse(query, RCODE.REFUSED);
  }
  if (query.name === HEALTH_NAME) {
    return buildResponse(query, RCODE.NOERROR, query.type === TYPE_A ? [HEALTH_ADDRESS] : []);
  }
  const local = `${query.name.slice(0, -suffix.length)}.local`;
  try {
    if (!(await deps.isSandbox(local))) return buildResponse(query, RCODE.NXDOMAIN);
    const addresses = await deps.lookup(local);
    if (addresses.length === 0) return buildResponse(query, RCODE.NXDOMAIN);
    // AAAA and friends: the name exists but only has A records (NODATA). The
    // sandbox's DNAT makes localhost-bound servers reachable on IPv4 only.
    return buildResponse(query, RCODE.NOERROR, query.type === TYPE_A ? addresses : []);
  } catch {
    return buildResponse(query, RCODE.SERVFAIL);
  }
}

/**
 * Memoize the sandbox-domain list: reuse it for `maxAgeMs`, but on a miss
 * refresh once it is older than `missAgeMs`, so a sandbox that just started is
 * found on its first query. Concurrent refreshes share one call.
 */
export function domainCache(
  list: () => Promise<string[]>,
  opts: { maxAgeMs?: number; missAgeMs?: number; now?: () => number } = {},
): (domain: string) => Promise<boolean> {
  const { maxAgeMs = 5000, missAgeMs = 500, now = Date.now } = opts;
  let domains = new Set<string>();
  let fetchedAt = -Infinity;
  let inFlight: Promise<void> | null = null;
  const refresh = () =>
    (inFlight ??= list()
      .then((names) => {
        domains = new Set(names.map((n) => n.toLowerCase()));
        fetchedAt = now();
      })
      .finally(() => {
        inFlight = null;
      }));
  return async (domain) => {
    if (now() - fetchedAt > maxAgeMs) await refresh();
    if (domains.has(domain)) return true;
    if (now() - fetchedAt > missAgeMs) await refresh();
    return domains.has(domain);
  };
}

/** {@link QueryDeps.lookup} via `getaddrinfo` — the macOS resolver, so OrbStack's mDNS answers. */
export async function systemLookup(name: string): Promise<string[]> {
  try {
    return (await lookup(name, { family: 4, all: true })).map((entry) => entry.address);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOTFOUND') return [];
    throw err;
  }
}

export interface DnsForwarderHandle {
  readonly port: number;
  dispose(): Promise<void>;
}

/** Serve {@link handleQuery} over UDP on 127.0.0.1 (only the Mac itself asks). */
export async function startDnsForwarder(opts: {
  /** `.local` domains of the running sandboxes (OrbStack `dev.orbstack.domains`). */
  sandboxDomains: () => Promise<string[]>;
  lookup: QueryDeps['lookup'];
  port?: number;
  onError?: (err: Error) => void;
}): Promise<DnsForwarderHandle> {
  const deps: QueryDeps = { isSandbox: domainCache(opts.sandboxDomains), lookup: opts.lookup };
  const socket: Socket = createSocket('udp4');
  let closed = false;
  socket.on('message', (msg, rinfo) => {
    handleQuery(msg, deps)
      .then((reply) => {
        // A lookup can outlive dispose(); sending on a closed socket throws.
        if (!reply || closed) return;
        socket.send(reply, rinfo.port, rinfo.address, (err) => {
          if (err) opts.onError?.(err);
        });
      })
      // send() also throws synchronously (e.g. a source port of 0); one bad
      // packet must never take the forwarder down.
      .catch((err: Error) => opts.onError?.(err));
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('error', (err) => {
      socket.close();
      reject(err);
    });
    socket.bind(opts.port ?? DEFAULT_DNS_PORT, '127.0.0.1', () => {
      socket.removeAllListeners('error');
      resolve();
    });
  });
  socket.on('error', (err) => opts.onError?.(err));
  return {
    port: (socket.address() as AddressInfo).port,
    dispose: () =>
      new Promise((resolve) => {
        closed = true;
        socket.close(() => resolve());
      }),
  };
}

export interface DnsStandbyHandle {
  /** True while this process holds the port and answers queries. */
  serving(): boolean;
  dispose(): Promise<void>;
}

type ForwarderOptions = Parameters<typeof startDnsForwarder>[0];

/**
 * Serve on `port` if it's free; otherwise stand by and retry the bind every
 * `retryMs`, so when the `orc start` currently serving exits, another running
 * one takes over within about that long. Resolves once the first bind attempt
 * settled, so {@link DnsStandbyHandle.serving} is meaningful right away.
 * Bind errors other than EADDRINUSE are reported via `onError` and retried.
 */
export async function startDnsStandby(
  opts: ForwarderOptions & { port: number; retryMs?: number },
): Promise<DnsStandbyHandle> {
  const retryMs = opts.retryMs ?? 1000;
  let forwarder: DnsForwarderHandle | null = null;
  let timer: NodeJS.Timeout | null = null;
  let disposed = false;

  const attempt = async (): Promise<void> => {
    timer = null;
    try {
      const started = await startDnsForwarder(opts);
      if (disposed) await started.dispose();
      else forwarder = started;
    } catch (err) {
      if (disposed) return;
      // EADDRINUSE is the normal standby case; anything else may be transient
      // and is worth another try too — giving up would silently drop `.test`
      // for every sandbox once the current server exits.
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') opts.onError?.(err as Error);
      // unref: standing by must never keep the process alive on its own.
      timer = setTimeout(() => void attempt(), retryMs).unref();
    }
  };
  await attempt();

  return {
    serving: () => forwarder !== null,
    dispose: async () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      await forwarder?.dispose();
      forwarder = null;
    },
  };
}

/**
 * Ask the forwarder on `port` for `name` (A). Resolves with the rcode and
 * addresses, or null when nothing answers within `timeoutMs`.
 */
export function queryDns(
  port: number,
  name: string,
  timeoutMs = 1000,
): Promise<{ rcode: number; addresses: string[] } | null> {
  const id = Math.floor(Math.random() * 0x10000);
  const qname = encodeName(name);
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2); // RD
  header.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(TYPE_A, 0);
  tail.writeUInt16BE(CLASS_IN, 2);
  const packet = Buffer.concat([header, qname, tail]);

  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    let settled = false;
    const done = (result: { rcode: number; addresses: string[] } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      resolve(result);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    socket.on('error', () => done(null));
    socket.on('message', (msg) => {
      if (msg.length < 12 || msg.readUInt16BE(0) !== id) return;
      done({ rcode: msg.readUInt16BE(2) & 0xf, addresses: parseAnswers(msg, packet.length) });
    });
    socket.send(packet, port, '127.0.0.1');
  });
}

/** A records from a response whose question section ends at `offset`. */
function parseAnswers(msg: Buffer, offset: number): string[] {
  const addresses: string[] = [];
  const count = msg.readUInt16BE(6);
  for (let i = 0; i < count && offset + 12 <= msg.length; i++) {
    // Our own responses always use a 2-byte name pointer.
    const type = msg.readUInt16BE(offset + 2);
    const rdlength = msg.readUInt16BE(offset + 10);
    const data = offset + 12;
    if (type === TYPE_A && rdlength === 4 && data + 4 <= msg.length) {
      addresses.push([...msg.subarray(data, data + 4)].join('.'));
    }
    offset = data + rdlength;
  }
  return addresses;
}
