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
  /**
   * Whether the boot cannot proceed without this port. False for orckit's own
   * mcp/web listeners: those are conveniences the CLI already degrades over
   * (it warns and continues), so a busy one must never abort a boot — that
   * would make a second project's `orc start` fail just because the first is
   * running.
   */
  required: boolean;
}

/**
 * The ports orckit's own MCP and web servers will bind this run, or null when
 * one won't run. The CLI derives them from its flags over the config
 * (`--no-mcp`, `--mcp-port`, `--no-web`, `--web-port`).
 */
export interface OrckitServerPorts {
  mcp: number | null;
  web: number | null;
}

/** The servers as the config alone describes them. */
export function configServerPorts(config: OrckitConfig): OrckitServerPorts {
  return {
    mcp: config.mcp.enabled ? config.mcp.port : null,
    web: config.web.enabled ? config.web.port : null,
  };
}

/**
 * All ports the boot of `names` is expected to bind, de-duplicated (first
 * source wins). Pure — consults only its arguments; `servers` defaults to the
 * config's `mcp` / `web` blocks.
 */
export function collectExpectedPorts(
  config: OrckitConfig,
  names: Iterable<string>,
  servers: OrckitServerPorts = configServerPorts(config),
): ExpectedPort[] {
  const seen = new Set<number>();
  const out: ExpectedPort[] = [];
  const add = (port: number, owner: string, source: ExpectedPort['source'], required: boolean) => {
    if (seen.has(port)) return;
    seen.add(port);
    out.push({ port, owner, source, required });
  };
  for (const name of names) {
    const processConfig = config.processes[name];
    if (!processConfig) continue;
    const endpoint = readyCheckLocalEndpoint(processConfig.ready);
    if (endpoint) add(endpoint.port, name, 'ready-check', true);
    for (const port of processConfig.ports) add(port, name, 'ports', true);
  }
  if (servers.mcp !== null) add(servers.mcp, 'orckit', 'mcp', false);
  if (servers.web !== null) add(servers.web, 'orckit', 'web', false);
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
