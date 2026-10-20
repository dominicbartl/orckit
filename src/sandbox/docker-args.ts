import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isUnderRoot } from '../web/open.js';
import type { Checkout } from './worktree.js';

/** Everything `docker run` needs to start one checkout's sandbox. Pure data. */
export interface SandboxRunSpec {
  /** Container name (also the volume prefix). */
  name: string;
  /** Hostname the Mac reaches the sandbox at (OrbStack `dev.orbstack.domains`). */
  domain: string;
  image: string;
  project: string;
  checkout: Checkout;
  /** Root of the orckit package to run inside — mounted at the same path. */
  packageRoot: string;
  /**
   * Mount `packageRoot` writable. Only when the project itself links to it
   * (a local `link:` dev setup): its package manager then installs into it and
   * chmods its bin, which fails on a read-only mount.
   */
  packageWritable: boolean;
  /** Absolute path of the config file (same path inside the sandbox). */
  configPath: string;
  /** Working directory inside the sandbox. */
  cwd: string;
  /** Attach a TTY (`-t`). */
  tty: boolean;
  /** Resource caps (`--memory`, `--cpus`). */
  memory?: string;
  cpus?: number;
  /** Mac-home paths seeded into the sandbox home on first start. */
  homeSeeds: Array<{ source: string; rel: string }>;
  /**
   * Package dirs (relative to the checkout root) whose `node_modules` gets a
   * sandbox-private volume instead of the Mac's directory.
   */
  packageDirs: string[];
  mounts: Array<{ source: string; target: string; readonly: boolean }>;
  env: Record<string, string>;
  /**
   * PID and start time of the host-side `orc start`, so a later run can tell a
   * live session from a headless one (the start time guards against PID reuse).
   */
  clientPid: number;
  clientStart: string;
  /** Re-copy `homeSeeds` even if the home volume was seeded before. */
  reseed: boolean;
  /** Arguments for the inner `orc start` (see {@link innerStartArgs}). */
  startArgs: string[];
}

export const SANDBOX_LABEL = 'orckit.sandbox';
export const CLIENT_PID_LABEL = 'orckit.client-pid';
export const CLIENT_START_LABEL = 'orckit.client-start';
export const WORKTREE_LABEL = 'orckit.worktree';
export const PROJECT_LABEL = 'orckit.project';

/** A sandbox's persistent volumes: the inner Docker image cache and its home. */
export function sandboxVolumes(name: string): [docker: string, home: string] {
  return [`${name}-docker`, `${name}-home`];
}

/** The private volume backing `<packageDir>/node_modules` in a sandbox. */
export function nodeModulesVolume(name: string, packageDir: string): string {
  const id = packageDir
    ? createHash('sha256').update(packageDir).digest('hex').slice(0, 10)
    : 'root';
  return `${name}-nm-${id}`;
}

/** Mount point of the Mac-home seed copies inside the sandbox. */
export const SEED_DIR = '/orckit-seed';

/**
 * The `docker run` argv for a sandbox. orckit runs as the container's main
 * process (behind `--init`) so `docker run`'s signal proxy and TTY carry
 * Ctrl-C / SIGTERM / SIGHUP straight to the inner `orc start`, whose own
 * teardown then runs unchanged. `--rm` + one container per sandbox means
 * `docker rm -f` is a complete kill switch: every process — nested
 * containers included — lives inside it.
 */
export function buildRunArgs(spec: SandboxRunSpec): string[] {
  const { checkout } = spec;
  const args = ['run', '--rm', '-i'];
  if (spec.tty) args.push('-t');
  args.push(
    '--init',
    // The inner dockerd needs it. Privileged inside OrbStack's Linux VM —
    // root in that VM, not on the Mac.
    '--privileged',
    '--name',
    spec.name,
    '--hostname',
    spec.name,
    '--label',
    `dev.orbstack.domains=${spec.domain}`,
    '--label',
    `${SANDBOX_LABEL}=${spec.name}`,
    '--label',
    `${PROJECT_LABEL}=${spec.project}`,
    '--label',
    `${WORKTREE_LABEL}=${checkout.root}`,
    '--label',
    `${CLIENT_PID_LABEL}=${spec.clientPid}`,
    '--label',
    `${CLIENT_START_LABEL}=${spec.clientStart}`,
  );

  if (spec.memory) args.push('--memory', spec.memory);
  if (spec.cpus) args.push('--cpus', String(spec.cpus));

  // Same-path mounts: file references in logs, IDE links and git's absolute
  // worktree pointers (`.git` → `<commonDir>/worktrees/<id>`) all stay valid.
  const mounted: string[] = [];
  const bind = (source: string, target: string, readonly: boolean) => {
    if (mounted.some((m) => isUnderRoot(target, m))) return;
    mounted.push(target);
    args.push('-v', `${source}:${target}${readonly ? ':ro' : ''}`);
  };
  bind(checkout.root, checkout.root, false);
  bind(checkout.commonDir, checkout.commonDir, false);
  bind(spec.packageRoot, spec.packageRoot, !spec.packageWritable);

  // Per-sandbox state that must survive restarts: the inner Docker image cache
  // and the sandbox's own home (seeded logins, corepack/pnpm caches).
  const [dockerVolume, homeVolume] = sandboxVolumes(spec.name);
  args.push('-v', `${dockerVolume}:/var/lib/docker`);
  args.push('-v', `${homeVolume}:/root`);
  for (const seed of spec.homeSeeds) {
    args.push('-v', `${seed.source}:${join(SEED_DIR, seed.rel)}:ro`);
  }
  // Over the checkout mount: the sandbox's own node_modules (Linux binaries),
  // so neither side ever runs the other platform's native executables.
  for (const dir of spec.packageDirs) {
    args.push(
      '-v',
      `${nodeModulesVolume(spec.name, dir)}:${join(checkout.root, dir, 'node_modules')}`,
    );
  }
  for (const m of spec.mounts) bind(m.source, m.target, m.readonly);

  const env: Record<string, string> = {
    ORCKIT_SANDBOX: spec.name,
    ORCKIT_SANDBOX_HOST: spec.domain,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    // Changes whenever copy_home does, so the entrypoint re-seeds an existing
    // home instead of silently skipping paths added later.
    ORCKIT_SEED_KEY: spec.homeSeeds
      .map((s) => s.rel)
      .sort()
      .join(','),
    ...(spec.reseed ? { ORCKIT_RESEED: '1' } : {}),
    ...spec.env,
  };
  for (const [key, value] of Object.entries(env)) args.push('-e', `${key}=${value}`);
  // Pass terminal capabilities through by name (value from the host env).
  for (const key of ['TERM', 'COLORTERM', 'FORCE_COLOR', 'NO_COLOR']) args.push('-e', key);

  args.push(
    '-w',
    spec.cwd,
    spec.image,
    'node',
    join(spec.packageRoot, 'dist', 'cli.js'),
    'start',
    ...spec.startArgs,
  );
  return args;
}

/** Host-only flags that must not reach the inner `orc start`. */
const HOST_ONLY_FLAGS = new Set(['--sandbox', '--no-sandbox', '--refresh-home']);

/**
 * The inner `orc start` argv: the user's own `start` arguments minus host-only
 * flags, with the config path made absolute (the inner process may run in a
 * different working directory).
 */
export function innerStartArgs(argsAfterStart: string[], configPath: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argsAfterStart.length; i++) {
    const arg = argsAfterStart[i]!;
    if (HOST_ONLY_FLAGS.has(arg)) continue;
    if (arg === '-c' || arg === '--config') {
      i++;
      continue;
    }
    if (arg.startsWith('--config=') || (arg.startsWith('-c') && arg.length > 2)) continue;
    out.push(arg);
  }
  return ['--config', configPath, ...out];
}
