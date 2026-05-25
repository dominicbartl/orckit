import { execa } from 'execa';
import type { ProcessConfig } from '../config/schema.js';
import { mergeEnv } from '../util/env.js';

/**
 * Fills in docker-specific defaults that the schema can't express without
 * coupling config validation to behavior. Currently: if `type: docker` and the
 * user did not set `stop_command`, derive one from `container_name`.
 *
 * Pure — returns a new config when defaults apply, the original otherwise.
 */
export function applyDockerDefaults(config: ProcessConfig): ProcessConfig {
  if (config.type !== 'docker' || !config.container_name) return config;
  if (config.stop_command) return config;
  return { ...config, stop_command: `docker rm -f ${config.container_name}` };
}

const ORPHAN_CLEANUP_TIMEOUT_MS = 30_000;

/**
 * Best-effort pre-spawn cleanup for `type: docker`. Removes any container that
 * still carries the configured `container_name` so the upcoming `docker run
 * --name <name>` doesn't fail with a name-conflict from a previous crashed
 * orckit run. Failures (docker not running, no such container, daemon
 * unreachable) are swallowed — the subsequent `docker run` will surface the
 * real error with better context.
 *
 * No-op for non-docker processes.
 */
export async function runDockerOrphanCleanup(config: ProcessConfig): Promise<void> {
  if (config.type !== 'docker' || !config.container_name) return;
  await execa(
    'bash',
    ['-c', `docker rm -f ${config.container_name} >/dev/null 2>&1 || true`],
    {
      cwd: config.cwd ?? process.cwd(),
      env: mergeEnv(config.env),
      reject: false,
      timeout: ORPHAN_CLEANUP_TIMEOUT_MS,
    },
  );
}
