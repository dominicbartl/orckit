import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import {
  CLIENT_PID_LABEL,
  CLIENT_START_LABEL,
  PROJECT_LABEL,
  SANDBOX_LABEL,
  WORKTREE_LABEL,
  sandboxVolumes,
} from './docker-args.js';
import { dnsLabel } from './worktree.js';

/**
 * Root of the orckit package this process runs from (`<root>/dist/sandbox/` →
 * `<root>`), symlinks resolved. Mounted read-only into the sandbox so the
 * inner `orc start` is exactly the same version as the outer one.
 */
export function packageRoot(): string {
  return realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'));
}

/** Run docker, returning trimmed stdout. Throws on non-zero exit. */
async function docker(args: string[]): Promise<string> {
  const { stdout } = await execa('docker', args);
  return stdout.trim();
}

/**
 * True when the Docker CLI talks to OrbStack. Sandboxes depend on two OrbStack
 * features no other engine on macOS has: container hostnames routed to the Mac
 * (`dev.orbstack.domains`) and file events forwarded into bind mounts.
 */
export async function isOrbStack(): Promise<boolean> {
  try {
    const out = await docker(['info', '--format', '{{.OperatingSystem}}|{{.Name}}']);
    return /orbstack/i.test(out);
  } catch {
    return false;
  }
}

async function imageExists(tag: string): Promise<boolean> {
  try {
    await docker(['image', 'inspect', '--format', '{{.Id}}', tag]);
    return true;
  } catch {
    return false;
  }
}

function shortHash(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) h.update(p).update('\0');
  return h.digest('hex').slice(0, 12);
}

export interface EnsureImageOptions {
  project: string;
  /** Absolute path of the project's `sandbox.dockerfile`, if any. */
  dockerfile?: string;
  /** Status line sink ("building …"). */
  log: (msg: string) => void;
}

/**
 * Make sure the sandbox image exists and return its tag. Images are tagged by
 * content hash, so editing orckit's base or the project Dockerfile triggers a
 * rebuild and nothing else does. Build output streams to the terminal (it only
 * happens on first use or after a change, and can take minutes).
 */
export async function ensureImage(opts: EnsureImageOptions): Promise<string> {
  const assets = join(packageRoot(), 'assets', 'sandbox');
  const baseHash = shortHash(
    readFileSync(join(assets, 'Dockerfile'), 'utf8'),
    readFileSync(join(assets, 'entrypoint.sh'), 'utf8'),
  );
  const baseTag = `orckit-sandbox-base:${baseHash}`;
  if (!(await imageExists(baseTag))) {
    opts.log(`building orckit sandbox base image ${baseTag} (first run only)`);
    await execa('docker', ['build', '-t', baseTag, '-t', 'orckit-sandbox-base:latest', assets], {
      stdio: 'inherit',
    });
  }
  if (!opts.dockerfile) return baseTag;

  const content = readFileSync(opts.dockerfile, 'utf8');
  const tag = `orckit-sandbox-${dnsLabel(opts.project)}:${shortHash(baseHash, content)}`;
  if (!(await imageExists(tag))) {
    opts.log(`building sandbox image ${tag} from ${opts.dockerfile}`);
    // No build context: the Dockerfile arrives on stdin, so the (possibly
    // huge) repository is never sent to the daemon.
    await execa('docker', ['build', '-t', tag, '--build-arg', `ORCKIT_BASE=${baseTag}`, '-'], {
      input: content,
      stdout: 'inherit',
      stderr: 'inherit',
    });
  }
  return tag;
}

/** One sandbox container as `orc sandbox list` shows it. */
export interface SandboxInfo {
  name: string;
  project: string;
  worktree: string;
  status: string;
  running: boolean;
  /** PID of the host `orc start` attached to it (may be dead → headless). */
  clientPid: number | null;
  /** That process's start time, to tell it apart from a recycled PID. */
  clientStart: string;
}

/** All orckit sandbox containers (running or not). */
export async function listSandboxes(): Promise<SandboxInfo[]> {
  const out = await docker([
    'ps',
    '-a',
    '--filter',
    `label=${SANDBOX_LABEL}`,
    '--format',
    `{{.Names}}\t{{.Label "${PROJECT_LABEL}"}}\t{{.Label "${WORKTREE_LABEL}"}}\t{{.State}}\t{{.Status}}\t{{.Label "${CLIENT_PID_LABEL}"}}\t{{.Label "${CLIENT_START_LABEL}"}}`,
  ]);
  if (!out) return [];
  return out.split('\n').map((line) => {
    const [name = '', project = '', worktree = '', state = '', status = '', pid = '', start = ''] =
      line.split('\t');
    const clientPid = Number(pid);
    return {
      name,
      project,
      worktree,
      status,
      running: state === 'running',
      clientPid: Number.isInteger(clientPid) && clientPid > 0 ? clientPid : null,
      clientStart: start,
    };
  });
}

/**
 * Stop a sandbox gracefully: `docker stop` SIGTERMs the inner `orc start`,
 * which runs its full teardown. The timeout covers slow stop graces (Firebase
 * emulators need ~30s); Docker SIGKILLs after it, which still takes everything
 * inside down with the container.
 */
export async function stopSandbox(name: string, timeoutSec = 120): Promise<void> {
  await assertExists(name);
  await docker(['stop', '-t', String(timeoutSec), name]);
}

async function assertExists(name: string): Promise<void> {
  if (!(await listSandboxes()).some((s) => s.name === name)) {
    throw new Error(`no sandbox named ${name} (see \`orc sandbox list\`)`);
  }
}

/** Force-remove a sandbox container (kills everything inside it). */
export async function removeSandbox(name: string): Promise<void> {
  await docker(['rm', '-f', name]);
}

/**
 * Create the sandbox's volumes (idempotent) labelled with the sandbox and its
 * worktree. `docker run --rm` removes the container on every stop but keeps
 * the volumes — the labels are what lets `orc sandbox list` show a stopped
 * sandbox and `orc sandbox prune` reclaim it once the worktree is deleted.
 */
export async function ensureSandboxVolumes(
  name: string,
  worktreeRoot: string,
  extra: string[] = [],
): Promise<void> {
  for (const volume of [...sandboxVolumes(name), ...extra]) {
    await docker([
      'volume',
      'create',
      '--label',
      `${SANDBOX_LABEL}=${name}`,
      '--label',
      `${WORKTREE_LABEL}=${worktreeRoot}`,
      volume,
    ]);
  }
}

/** Sandboxes that only have volumes left (stopped), by name → worktree. */
export async function listSandboxVolumes(): Promise<Map<string, string>> {
  const out = await docker([
    'volume',
    'ls',
    '--filter',
    `label=${SANDBOX_LABEL}`,
    '--format',
    `{{.Label "${SANDBOX_LABEL}"}}\t{{.Label "${WORKTREE_LABEL}"}}`,
  ]);
  const byName = new Map<string, string>();
  for (const line of out ? out.split('\n') : []) {
    const [name = '', worktree = ''] = line.split('\t');
    if (name) byName.set(name, worktree);
  }
  return byName;
}

/** Remove all of a sandbox's volumes (image cache, home, node_modules). */
export async function removeSandboxVolumes(name: string): Promise<void> {
  const labelled = await docker([
    'volume',
    'ls',
    '-q',
    '--filter',
    `label=${SANDBOX_LABEL}=${name}`,
  ]);
  const volumes = new Set([...sandboxVolumes(name), ...(labelled ? labelled.split('\n') : [])]);
  await docker(['volume', 'rm', '-f', ...volumes]);
}
