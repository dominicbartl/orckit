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
    // lsof exits 1 (no error object on some platforms, ENOENT when absent) when
    // nothing matches — every non-match path collapses to an empty list.
    execFile('lsof', ['-ti', `tcp:${port}`], (_err, stdout) => {
      const pids = (stdout ?? '')
        .split('\n')
        .map((line) => Number(line.trim()))
        .filter((n) => Number.isInteger(n) && n > 0 && n !== process.pid);
      resolve([...new Set(pids)]);
    });
  });
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
