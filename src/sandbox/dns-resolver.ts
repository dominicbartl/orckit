import { lookup } from 'node:dns/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execa } from 'execa';
import { listSandboxDomains } from './engine.js';
import {
  DEFAULT_DNS_PORT,
  DNS_SUFFIX,
  HEALTH_ADDRESS,
  HEALTH_NAME,
  queryDns,
  startDnsForwarder,
  systemLookup,
} from './dns.js';

/**
 * The one-time, root-owned half of `.test` sandbox names (see `dns.ts`): a
 * resolver(5) file that sends `.test` to 127.0.0.1:<port>. Nothing runs in the
 * background — the forwarder lives in the Mac-side `orc start` of each running
 * sandbox. Install and status prove the routing with a short-lived forwarder
 * of their own when no sandbox is serving.
 */

export const RESOLVER_FILE = `/etc/resolver/${DNS_SUFFIX}`;
/**
 * Where `install --force` keeps a resolver file another tool wrote, for
 * `uninstall` to put back. Not under /etc/resolver: every file there is read
 * as a resolver for the domain it's named after.
 */
export const RESOLVER_BACKUP = `/etc/orckit-resolver-${DNS_SUFFIX}.backup`;
const MARKER = '# managed by orckit (`orc sandbox dns install`)';

/** `/etc/resolver/test` content (resolver(5)): nameserver + non-standard port. */
export function resolverConfig(port: number): string {
  return `${MARKER}\nnameserver 127.0.0.1\nport ${port}\n`;
}

/** The forwarder port from an orckit-managed resolver file; null if it isn't ours. */
export function parseResolverPort(content: string): number | null {
  if (!content.includes(MARKER)) return null;
  const match = /^port\s+(\d+)\s*$/m.exec(content);
  return match ? Number(match[1]) : 53;
}

/** The forwarder port when orckit set up `.test`, else null. */
export function installedDnsPort(file = RESOLVER_FILE): number | null {
  try {
    return parseResolverPort(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * True when an orckit forwarder answers on `port` — the health name with its
 * own address, so another DNS server holding the port doesn't count.
 */
export async function forwarderAlive(port: number, timeoutMs = 500): Promise<boolean> {
  const answer = await queryDns(port, HEALTH_NAME, timeoutMs);
  return answer?.rcode === 0 && answer.addresses.includes(HEALTH_ADDRESS);
}

/**
 * The whole path works: `getaddrinfo` (what browsers and curl use) sends the
 * health name through `/etc/resolver/test` to a forwarder.
 */
export async function systemRoutesTest(): Promise<boolean> {
  try {
    const { address } = await lookup(HEALTH_NAME, { family: 4 });
    return address === HEALTH_ADDRESS;
  } catch {
    return false;
  }
}

/**
 * Run `fn` with a forwarder answering on `port`: a sandbox's, if one serves,
 * otherwise a temporary one — a full one, since a sandbox started meanwhile
 * (install waits on a sudo prompt) stands by behind it. Throws when something
 * else holds the port.
 */
async function withForwarder<T>(port: number, fn: () => Promise<T>): Promise<T> {
  if (await forwarderAlive(port)) return fn();
  let temporary;
  try {
    temporary = await startDnsForwarder({
      port,
      sandboxDomains: listSandboxDomains,
      lookup: systemLookup,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    // A sandbox may have bound it between the check and the bind.
    if (await forwarderAlive(port)) return fn();
    throw new Error(
      `127.0.0.1:${port} is taken by something other than orckit — ` +
        'pick another port with `orc sandbox dns install --port <port>`',
    );
  }
  try {
    return await fn();
  } finally {
    await temporary.dispose();
  }
}

export interface InstallOptions {
  port?: number;
  /** Replace a `/etc/resolver/test` orckit didn't write (kept for uninstall). */
  force?: boolean;
  log: (msg: string) => void;
}

export async function installDns(opts: InstallOptions): Promise<void> {
  assertMac();
  const port = opts.port ?? DEFAULT_DNS_PORT;
  const existing = existsSync(RESOLVER_FILE) ? readFileSync(RESOLVER_FILE, 'utf8') : null;
  const previousPort = existing === null ? null : parseResolverPort(existing);
  const foreign = existing !== null && previousPort === null;
  if (previousPort !== null && previousPort !== port) {
    opts.log(
      `moving from port ${previousPort} to ${port} — sandboxes already running keep ` +
        'serving the old port; restart them for .test to resolve',
    );
  }
  if (foreign && !opts.force) {
    throw new Error(
      `${RESOLVER_FILE} exists and wasn't written by orckit — another tool routes .test ` +
        '(pass --force to replace it; uninstall puts it back)',
    );
  }

  await withForwarder(port, async () => {
    const config = resolverConfig(port);
    if (existing !== config) {
      opts.log(`writing ${RESOLVER_FILE} (sudo)`);
      if (foreign) {
        await execa('sudo', ['cp', RESOLVER_FILE, RESOLVER_BACKUP], { stdio: 'inherit' });
        opts.log(`kept the previous ${RESOLVER_FILE} as ${RESOLVER_BACKUP}`);
      }
      await execa('sudo', ['mkdir', '-p', '/etc/resolver'], { stdio: 'inherit' });
      await execa('sudo', ['tee', RESOLVER_FILE], {
        input: config,
        stdout: 'ignore',
        stderr: 'inherit',
      });
    }
    // macOS picks up resolver files on its own, usually within a second.
    if (!(await waitFor(systemRoutesTest, 5000))) {
      throw new Error(
        `${RESOLVER_FILE} is in place but macOS doesn't route .test through it yet — ` +
          'check `scutil --dns`, or flush the cache: ' +
          '`sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`',
      );
    }
  });
}

/** Remove orckit's resolver file; false when there was none. */
export async function uninstallDns(log: (msg: string) => void): Promise<boolean> {
  assertMac();
  if (installedDnsPort() === null) return false;
  if (existsSync(RESOLVER_BACKUP)) {
    log(`restoring ${RESOLVER_FILE} from ${RESOLVER_BACKUP} (sudo)`);
    await execa('sudo', ['mv', RESOLVER_BACKUP, RESOLVER_FILE], { stdio: 'inherit' });
  } else {
    log(`removing ${RESOLVER_FILE} (sudo)`);
    await execa('sudo', ['rm', '-f', RESOLVER_FILE], { stdio: 'inherit' });
  }
  return true;
}

/** What `orc sandbox dns status` reports. */
export interface DnsStatus {
  /** Port from orckit's resolver file; null when there is none. */
  port: number | null;
  /** A running sandbox's `orc start` is answering on the port right now. */
  serving: boolean;
  /** macOS routes `.test` to the port (checked with a temporary forwarder if needed). */
  systemRoutes: boolean;
  /** Why the routing couldn't be checked (e.g. the port is taken). */
  error?: string;
}

export async function dnsStatus(): Promise<DnsStatus> {
  const port = installedDnsPort();
  if (port === null) return { port, serving: false, systemRoutes: false };
  const serving = await forwarderAlive(port);
  try {
    return { port, serving, systemRoutes: await withForwarder(port, systemRoutesTest) };
  } catch (err) {
    return { port, serving, systemRoutes: false, error: (err as Error).message };
  }
}

function assertMac(): void {
  if (process.platform !== 'darwin') throw new Error('`.test` sandbox names are macOS-only');
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
