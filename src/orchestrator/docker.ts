import { execa } from 'execa';
import type { ProcessConfig } from '../config/schema.js';
import { mergeEnv } from '../util/env.js';

const DOCKER_RM_TIMEOUT_MS = 30_000;

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
export async function removeDockerContainer(config: ProcessConfig): Promise<void> {
  if (config.type !== 'docker' || !config.container_name) return;
  await execa('bash', ['-c', `docker rm -f ${config.container_name} >/dev/null 2>&1 || true`], {
    cwd: config.cwd ?? process.cwd(),
    env: mergeEnv(config.env),
    reject: false,
    timeout: DOCKER_RM_TIMEOUT_MS,
  });
}
