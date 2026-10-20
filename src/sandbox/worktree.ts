import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

/** A linked git worktree (never the main checkout). */
export interface Worktree {
  /**
   * The worktree's id — the name of its admin dir under `.git/worktrees/`.
   * Git keeps it unique per repository and it survives branch switches and
   * detached HEADs, which is why it names the sandbox instead of the branch.
   */
  id: string;
  /** Absolute top-level directory of the worktree. */
  root: string;
  /** Absolute shared `.git` directory of the repository. */
  commonDir: string;
  /** Absolute top-level directory of the main checkout. */
  mainRoot: string;
}

/**
 * Pure part of worktree detection: `git rev-parse --path-format=absolute
 * --git-dir --git-common-dir --show-toplevel` output → Worktree, or null for a
 * main checkout (its git dir IS the common dir).
 */
export function parseWorktree(gitDir: string, commonDir: string, root: string): Worktree | null {
  if (resolve(gitDir) === resolve(commonDir)) return null;
  // A main checkout's common dir is `<mainRoot>/.git`; a bare repo has no
  // main checkout, so fall back to the common dir's parent anyway.
  return { id: basename(gitDir), root, commonDir, mainRoot: dirname(commonDir) };
}

/** Detect whether `dir` is inside a linked worktree. Null outside git, too. */
export function detectWorktree(dir: string): Worktree | null {
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
  return parseWorktree(gitDir, commonDir, root);
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

/** Expand a `sandbox.domain` template: `{name}` → worktree id, `{project}`. */
export function sandboxDomain(template: string, project: string, worktreeId: string): string {
  return template
    .replaceAll('{name}', dnsLabel(worktreeId))
    .replaceAll('{project}', dnsLabel(project));
}
