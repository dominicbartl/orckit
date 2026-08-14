import { createServer } from 'node:net';
import { execFile } from 'node:child_process';

export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

/**
 * PIDs currently holding `port` over TCP on the local host, via `lsof`. Used by
 * the orphan-port sweep to find escaped processes that survived a process-tree
 * kill but kept a port bound (see `Runner.stop` / `kill_orphan_ports`).
 *
 * Best-effort and POSIX-only: resolves to `[]` when nothing holds the port,
 * when `lsof` isn't installed (ENOENT), or on any error. The orchestrator's own
 * pid is filtered out so a self-referential listener can never be a target.
 */
export function findPortHolders(port: number): Promise<number[]> {
  return new Promise((resolve) => {
    // `-t` => terse, pids only; `-i tcp:PORT` => the TCP socket on that port.
    // `-sTCP:LISTEN` is load-bearing: without it lsof also matches processes
    // with a mere client connection to the port (a browser talking to the dev
    // server, a VM manager's closed forwards) and the sweep would SIGKILL an
    // innocent bystander instead of the actual listener.
    // lsof exits 1 (no error object on some platforms, ENOENT when absent) when
    // nothing matches — every non-match path collapses to an empty list.
    execFile('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], (_err, stdout) => {
      const pids = (stdout ?? '')
        .split('\n')
        .map((line) => Number(line.trim()))
        .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
      resolve([...new Set(pids)]);
    });
  });
}

export interface PortHolderInfo {
  pid: number;
  /** Full command line, or a placeholder when the process vanished mid-lookup. */
  command: string;
  /** `ps`'s lstart, e.g. "Thu Aug 14 09:52:16 2026". Undefined when unavailable. */
  startedAt?: string;
}

/**
 * Describe the processes currently LISTENING on `port`: pid, full command line
 * and start time, via `ps`. Best-effort — a pid that exits between the lsof and
 * the ps still yields an entry (with a placeholder command) so callers can act
 * on it.
 */
export async function describePortHolders(port: number): Promise<PortHolderInfo[]> {
  const pids = await findPortHolders(port);
  return Promise.all(
    pids.map(
      (pid) =>
        new Promise<PortHolderInfo>((resolve) => {
          execFile('ps', ['-p', String(pid), '-o', 'lstart=,command='], (_err, stdout) => {
            const line = (stdout ?? '').trim();
            if (!line) {
              resolve({ pid, command: '<exited>' });
              return;
            }
            // lstart is a fixed 5-field prefix: "Thu Aug 14 09:52:16 2026 cmd..."
            const parts = line.split(/\s+/);
            const startedAt = parts.slice(0, 5).join(' ');
            const command = parts.slice(5).join(' ') || '<unknown>';
            resolve({ pid, command, startedAt });
          });
        }),
    ),
  );
}

/**
 * Gracefully free `port`: SIGTERM every listener, wait up to `graceMs` for the
 * port to be released, then SIGKILL anything still holding it. Resolves `true`
 * when the port ended up free, `false` when something still holds it (e.g. a
 * Docker VM's port proxy that respawns, or a pid we may not signal).
 */
export async function freePort(port: number, graceMs = 3000): Promise<boolean> {
  const holders = await findPortHolders(port);
  if (holders.length === 0) return true;
  for (const pid of holders) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone or not permitted; the verification loop below decides
    }
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  for (const pid of await findPortHolders(port)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone or not permitted
    }
  }
  // SIGKILL is instant, but the kernel may take a beat to release the socket.
  const killDeadline = Date.now() + 1000;
  while (Date.now() < killDeadline) {
    if (await isPortFree(port)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return isPortFree(port);
}

/**
 * Force-kill (SIGKILL) any process holding one of `ports`. Returns one entry per
 * killed (port, pid) so a reporter can surface exactly what was reaped.
 *
 * Best-effort: a port with no holder, a pid that's already gone or not
 * permitted to signal, or a platform without `lsof` all yield no entry. Never
 * throws.
 */
export async function killPortHolders(
  ports: number[],
): Promise<Array<{ port: number; pid: number }>> {
  const freed: Array<{ port: number; pid: number }> = [];
  for (const port of ports) {
    const holders = await findPortHolders(port);
    for (const pid of holders) {
      try {
        process.kill(pid, 'SIGKILL');
        freed.push({ port, pid });
      } catch {
        // Already exited between the lsof and the kill, or not permitted.
      }
    }
  }
  return freed;
}
