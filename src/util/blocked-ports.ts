import type { OrckitConfig } from '../config/schema.js';
import { readyCheckLocalEndpoint } from '../health/checks.js';
import { describePortHolders, type PortHolderInfo } from './port.js';

/**
 * A local TCP port the upcoming boot needs to be free, and why.
 * Sources, in collection order:
 *   - `ready-check`: the local endpoint of an `http`/`tcp` ready check — if
 *     something else is listening there, the probe would falsely succeed
 *     against it while the real process fails to bind.
 *   - `ports`: the process's declared `ports` list.
 *   - `mcp` / `web`: orckit's own built-in servers (a stale `orc start` from a
 *     previous session is the classic holder).
 */
export interface ExpectedPort {
  port: number;
  /** Process name (or `orckit` for the built-in mcp/web listeners). */
  owner: string;
  source: 'ready-check' | 'ports' | 'mcp' | 'web';
}

/**
 * All ports the boot of `names` is expected to bind, de-duplicated (first
 * source wins). Pure — consults only the config.
 */
export function collectExpectedPorts(
  config: OrckitConfig,
  names: Iterable<string>,
): ExpectedPort[] {
  const seen = new Set<number>();
  const out: ExpectedPort[] = [];
  const add = (port: number, owner: string, source: ExpectedPort['source']) => {
    if (seen.has(port)) return;
    seen.add(port);
    out.push({ port, owner, source });
  };
  for (const name of names) {
    const processConfig = config.processes[name];
    if (!processConfig) continue;
    const endpoint = readyCheckLocalEndpoint(processConfig.ready);
    if (endpoint) add(endpoint.port, name, 'ready-check');
    for (const port of processConfig.ports) add(port, name, 'ports');
  }
  if (config.mcp.enabled) add(config.mcp.port, 'orckit', 'mcp');
  if (config.web.enabled) add(config.web.port, 'orckit', 'web');
  return out;
}

export interface BlockedPort extends ExpectedPort {
  holders: PortHolderInfo[];
}

/**
 * Which of `expected` currently have a listener, with pid/command/start-time
 * info per holder so a caller can show the user exactly what is in the way.
 * Best-effort and POSIX-only (lsof); resolves to [] where lsof is unavailable.
 */
export async function findBlockedPorts(expected: ExpectedPort[]): Promise<BlockedPort[]> {
  const results = await Promise.all(
    expected.map(async (e) => ({ ...e, holders: await describePortHolders(e.port) })),
  );
  return results.filter((r) => r.holders.length > 0);
}

/**
 * True when the listener looks like a container platform's port proxy
 * (Docker Desktop, OrbStack, colima/lima VMs). Killing that pid would wound
 * the VM manager, NOT free the port — the fix is removing the container that
 * publishes the port.
 */
export function isContainerProxy(command: string): boolean {
  return /com\.docker|docker-proxy|dockerd|orbstack|vpnkit|colima|lima/i.test(command);
}
