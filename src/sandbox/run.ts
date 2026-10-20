import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { sandboxConfigSchema, type OrckitConfig, type SandboxConfig } from '../config/schema.js';
import type { IdeLink } from '../web/ide.js';
import { isUnderRoot } from '../web/open.js';
import { buildRunArgs, innerStartArgs } from './docker-args.js';
import { isAlive, processStartTime } from '../util/session-state.js';
import {
  ensureImage,
  ensureSandboxVolumes,
  isOrbStack,
  listSandboxes,
  packageRoot,
  removeSandbox,
  type SandboxInfo,
} from './engine.js';
import { startOpenRelay } from './relay.js';
import { containerName, sandboxDomain, type Checkout } from './worktree.js';

/** Sandbox defaults for a `--sandbox` run without a `sandbox:` block. */
const DEFAULT_SANDBOX: SandboxConfig = sandboxConfigSchema.parse({});

/**
 * Whether this `orc start` should hand off to a sandbox. Never from inside a
 * sandbox (no recursion); `--no-sandbox` always wins; `--sandbox` forces it
 * (sandboxes are named after the git checkout, so it needs one). Otherwise an
 * enabled `sandbox:` block turns it on for linked worktrees, and for the main
 * checkout only with `main_checkout: true`.
 */
export function shouldSandbox(opts: {
  flag: boolean | undefined;
  config: OrckitConfig;
  checkout: Checkout | null;
  insideSandbox: boolean;
}): boolean {
  if (opts.insideSandbox || opts.flag === false) return false;
  if (opts.flag === true) {
    if (!opts.checkout) {
      throw new Error(
        '--sandbox needs a git checkout (sandboxes are named after it) — ' +
          'run it inside a git repository, or drop --sandbox to run natively',
      );
    }
    return true;
  }
  const sandbox = opts.config.sandbox;
  if (!sandbox?.enabled || !opts.checkout) return false;
  return opts.checkout.linked || sandbox.main_checkout;
}

export interface SandboxRunRequest {
  config: OrckitConfig;
  /** Absolute config path. */
  configPath: string;
  checkout: Checkout;
  /** The user's `orc start` arguments (everything after `start`). */
  argsAfterStart: string[];
  refreshHome: boolean;
  /** Same semantics as the blocked-port check: what to do with a headless leftover. */
  leftoverMode: 'ask' | 'kill' | 'fail';
  ide: IdeLink | null;
  log: (msg: string) => void;
  warn: (msg: string) => void;
  confirm: (question: string) => Promise<boolean>;
}

/** Expand `~` and resolve relative paths against `base`. */
export function expandPath(path: string, base: string, home = homedir()): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return isAbsolute(path) ? path : resolve(base, path);
}

/**
 * Run `orc start` for this checkout inside its sandbox and resolve with the
 * exit code to exit with. The inner orc owns the whole environment; this side
 * only prepares the container, relays IDE opens, forwards signals and waits.
 */
export async function runInSandbox(req: SandboxRunRequest): Promise<number> {
  const sandbox = req.config.sandbox ?? DEFAULT_SANDBOX;
  const configDir = dirname(req.configPath);
  const { checkout } = req;

  if (!(await isOrbStack())) {
    throw new Error(
      'sandbox mode needs OrbStack as the Docker engine (container hostnames + file events) — ' +
        'start OrbStack, or pass --no-sandbox to run natively',
    );
  }

  const name = containerName(req.config.project, checkout.id);
  const domain = sandboxDomain(sandbox.domain, req.config.project, checkout.id);

  await clearLeftover(name, req);
  await ensureSandboxVolumes(name, checkout.root);
  copyMissingFiles(sandbox.copy_files, checkout, req);

  const image = await ensureImage({
    project: req.config.project,
    dockerfile: sandbox.dockerfile ? expandPath(sandbox.dockerfile, configDir) : undefined,
    log: req.log,
  });

  const homeSeeds: Array<{ source: string; rel: string }> = [];
  for (const rel of sandbox.copy_home) {
    const source = join(homedir(), rel);
    if (existsSync(source)) homeSeeds.push({ source, rel });
    else req.warn(`copy_home: ~/${rel} does not exist on this Mac — skipped`);
  }
  const mounts = sandbox.mounts.map((m) => {
    const source = expandPath(m.source, configDir);
    return {
      source,
      target: m.target ? expandPath(m.target, configDir) : source,
      readonly: m.readonly,
    };
  });
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(sandbox.env)) {
    env[key] = value === '~' || value.startsWith('~/') ? expandPath(value, configDir) : value;
  }

  // Relative `cwd`s and log dirs resolve against the working directory, so the
  // inner orc must start where this one did. Only the checkout is mounted.
  const cwd = isUnderRoot(process.cwd(), checkout.root) ? process.cwd() : configDir;
  if (cwd !== process.cwd()) {
    req.warn(
      `running from outside the checkout — relative paths in the config resolve against ${cwd} inside the sandbox`,
    );
  }

  const relay = req.ide ? await startOpenRelay(req.ide) : null;
  if (relay && req.ide) {
    env.ORCKIT_OPEN_RELAY = relay.url;
    env.ORCKIT_SANDBOX_IDE = JSON.stringify(req.ide);
  }

  const orckitRoot = packageRoot();
  const args = buildRunArgs({
    name,
    domain,
    image,
    project: req.config.project,
    checkout,
    packageRoot: orckitRoot,
    packageWritable: linksPackage(checkout.root, orckitRoot),
    configPath: req.configPath,
    cwd,
    tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    memory: sandbox.memory,
    cpus: sandbox.cpus,
    homeSeeds,
    mounts,
    env,
    clientPid: process.pid,
    clientStart: (await processStartTime(process.pid)) ?? '',
    reseed: req.refreshHome,
    startArgs: innerStartArgs(req.argsAfterStart, req.configPath),
  });

  req.log(`sandbox ${name} → ${domain} (also ${name}.orb.local)`);
  try {
    return await runDocker(args);
  } finally {
    await relay?.dispose();
  }
}

/**
 * A container with this sandbox's name already exists. If the `orc start` that
 * owns it is still alive (another terminal), refuse. Otherwise it's headless —
 * its client was killed — and still running the whole environment: remove it
 * (ask / kill / fail, like the blocked-port check) before starting fresh.
 */
async function clearLeftover(name: string, req: SandboxRunRequest): Promise<void> {
  const existing = (await listSandboxes()).find((s) => s.name === name);
  if (!existing) return;
  if (existing.running && existing.clientPid && (await clientAlive(existing))) {
    throw new Error(
      `sandbox ${name} is already running (orc start pid ${existing.clientPid}) — ` +
        `stop it there, or run \`orc sandbox stop ${name}\``,
    );
  }
  req.warn(`sandbox ${name} is still ${existing.running ? 'running headless' : existing.status}`);
  const remove =
    req.leftoverMode === 'kill' ||
    (req.leftoverMode === 'ask' && (await req.confirm('    remove it and start fresh? [Y/n] ')));
  if (!remove) {
    throw new Error(
      `not starting on top of sandbox ${name} — \`orc sandbox rm ${name}\` removes it`,
    );
  }
  await removeSandbox(name);
}

/**
 * True when the checkout's own `node_modules/@orckit/cli` resolves to the
 * orckit we run (a `link:` to a local orckit checkout). The project's install
 * inside the sandbox then writes to that package, so it can't be read-only.
 */
export function linksPackage(checkoutRoot: string, orckitRoot: string): boolean {
  try {
    return realpathSync(join(checkoutRoot, 'node_modules', '@orckit', 'cli')) === orckitRoot;
  } catch {
    return false;
  }
}

/** sandbox.copy_files: bring git-ignored files from the main checkout into a fresh worktree. */
function copyMissingFiles(files: string[], checkout: Checkout, req: SandboxRunRequest): void {
  if (!checkout.linked) return; // the main checkout is where they come from
  for (const rel of files) {
    const dest = join(checkout.root, rel);
    if (existsSync(dest)) continue;
    const source = join(checkout.mainRoot, rel);
    if (!existsSync(source)) {
      req.warn(`copy_files: ${rel} is missing in the main checkout too — skipped`);
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(source, dest, { recursive: true });
    req.log(`copied ${rel} from the main checkout`);
  }
}

/**
 * Run the docker CLI in the foreground with the terminal attached. With a TTY,
 * Ctrl-C is a byte the container's terminal turns into SIGINT for the inner
 * orc — this process must not die of it first, so SIGINT is ignored here.
 * SIGTERM / SIGHUP are passed on; `docker run`'s signal proxy delivers them.
 */
function runDocker(args: string[]): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', args, { stdio: 'inherit' });
    const forward = (signal: NodeJS.Signals) => child.kill(signal);
    const ignore = () => {};
    process.on('SIGINT', ignore);
    process.on('SIGTERM', forward);
    process.on('SIGHUP', forward);
    const cleanup = () => {
      process.off('SIGINT', ignore);
      process.off('SIGTERM', forward);
      process.off('SIGHUP', forward);
    };
    child.once('error', (err) => {
      cleanup();
      reject(err);
    });
    child.once('exit', (code, signal) => {
      cleanup();
      resolvePromise(code ?? (signal ? 128 + signalNumber(signal) : 1));
    });
  });
}

function signalNumber(signal: NodeJS.Signals): number {
  return { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 }[signal as string] ?? 1;
}

/** The sandbox's host `orc start` is still running (same pid AND start time). */
async function clientAlive(sandbox: SandboxInfo): Promise<boolean> {
  if (!sandbox.clientPid || !isAlive(sandbox.clientPid)) return false;
  if (!sandbox.clientStart) return true;
  return (await processStartTime(sandbox.clientPid)) === sandbox.clientStart;
}
