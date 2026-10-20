import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

/** Sandbox id of a repository's main checkout. */
export const MAIN_CHECKOUT_ID = 'main';

/** A git checkout a sandbox can run: the main checkout or a linked worktree. */
export interface Checkout {
  /**
   * Names the sandbox. For a linked worktree its id — the name of its admin
   * dir under `.git/worktrees/`, which git keeps unique per repository and
   * which survives branch switches and detached HEADs. For the main checkout
   * {@link MAIN_CHECKOUT_ID}.
   */
  id: string;
  /** Absolute top-level directory of this checkout. */
  root: string;
  /** Absolute shared `.git` directory of the repository. */
  commonDir: string;
  /** Absolute top-level directory of the main checkout. */
  mainRoot: string;
  /** True for a linked worktree, false for the main checkout. */
  linked: boolean;
}

/**
 * Pure part of checkout detection: `git rev-parse --path-format=absolute
 * --git-dir --git-common-dir --show-toplevel` output → Checkout. A main
 * checkout's git dir IS the common dir; a linked worktree's lives under it.
 */
export function parseCheckout(gitDir: string, commonDir: string, root: string): Checkout {
  if (resolve(gitDir) === resolve(commonDir)) {
    return { id: MAIN_CHECKOUT_ID, root, commonDir, mainRoot: root, linked: false };
  }
  // A main checkout's common dir is `<mainRoot>/.git`; a bare repo has no
  // main checkout, so fall back to the common dir's parent anyway.
  return { id: basename(gitDir), root, commonDir, mainRoot: dirname(commonDir), linked: true };
}

/** The git checkout `dir` is in, or null outside git. */
export function detectCheckout(dir: string): Checkout | null {
  let out: string;
  try {
    out = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch {
    return null;
  }
  const [gitDir, commonDir, root] = out.trim().split('\n');
  if (!gitDir || !commonDir || !root || !isAbsolute(gitDir)) return null;
  return parseCheckout(gitDir, commonDir, root);
}

/** Lowercase DNS label: `[a-z0-9-]`, no leading/trailing dash, ≤ `max` chars. */
export function dnsLabel(value: string, max = 63): string {
  const label = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, max)
    .replace(/^-+|-+$/g, '');
  return label || 'x';
}

/**
 * Docker container name for a project's worktree sandbox. It doubles as the
 * container hostname (Docker caps those at 64 bytes) and the `<name>.orb.local`
 * DNS label (63), so long names are shortened — with a hash of the full id so
 * two long worktree ids sharing a prefix still get distinct sandboxes.
 */
export function containerName(project: string, worktreeId: string): string {
  const name = `orckit-${dnsLabel(project, 20)}-${dnsLabel(worktreeId)}`;
  if (name.length <= 63) return name;
  const hash = createHash('sha256').update(worktreeId).digest('hex').slice(0, 6);
  return `${name.slice(0, 63 - hash.length - 1).replace(/-+$/, '')}-${hash}`;
}

/** Expand a `sandbox.domain` template: `{name}` → checkout id, `{project}`. */
export function sandboxDomain(template: string, project: string, worktreeId: string): string {
  return template
    .replaceAll('{name}', dnsLabel(worktreeId))
    .replaceAll('{project}', dnsLabel(project));
}
