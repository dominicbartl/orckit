import { spawnSync } from 'node:child_process';
import { execa } from 'execa';
import type { ProcessConfig } from '../config/schema.js';
import { mergeEnv } from '../util/env.js';

const DOCKER_RM_TIMEOUT_MS = 30_000;
/**
 * Much tighter than the async path: the sync variant runs on force-quit and
 * crash paths where the user is already waiting, and a wedged docker daemon
 * must not turn "exit now" into a hang.
 */
const DOCKER_RM_SYNC_TIMEOUT_MS = 5_000;

/**
 * Force-remove the container backing a `type: docker` process.
 *
 * Run in two places, both best-effort and idempotent:
 *   - **before every spawn**, so a container left behind by a previous crashed
 *     run doesn't block the upcoming `docker run --name <name>` with a name
 *     conflict;
 *   - **after the process is stopped or killed**, so the container — which is
 *     owned by dockerd, not the local `docker run` CLI orckit just signalled —
 *     doesn't linger and keep its published ports bound for the next boot.
 *
 * Failures (no such container, daemon down, docker not installed) are swallowed:
 * a pre-spawn failure surfaces later through the real `docker run`, and a
 * post-stop failure just means there was nothing to remove.
 *
 * No-op for non-docker processes (or docker processes without a container_name,
 * which the schema already rejects).
 */
/**
 * Blocking variant of {@link removeDockerContainer}, for the emergency paths
 * (double Ctrl-C, uncaughtException) that must finish before `process.exit()`
 * and therefore cannot await anything. A daemon-owned container outlives the
 * process that started it, so skipping this would leave the container — and
 * its published ports — held after orckit is gone.
 */
export function removeDockerContainerSync(config: ProcessConfig): void {
  if (config.type !== 'docker' || !config.container_name) return;
  try {
    spawnSync('docker', ['rm', '-f', config.container_name], {
      timeout: DOCKER_RM_SYNC_TIMEOUT_MS,
      stdio: 'ignore',
    });
  } catch {
    // docker missing / daemon down / timed out — nothing more we can do here
  }
}

export async function removeDockerContainer(config: ProcessConfig): Promise<void> {
  if (config.type !== 'docker' || !config.container_name) return;
  await execa('bash', ['-c', `docker rm -f ${config.container_name} >/dev/null 2>&1 || true`], {
    cwd: config.cwd ?? process.cwd(),
    env: mergeEnv(config.env),
    reject: false,
    timeout: DOCKER_RM_TIMEOUT_MS,
  });
}
