import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Directories (relative to `root`, `''` for the root itself) that hold a
 * `package.json` — every place an install creates a `node_modules`. Looks
 * from `package.json` rather than existing `node_modules`, so a fresh
 * worktree that has never been installed is covered too. Skips
 * `node_modules` and dot-directories, and stops at `maxDepth` levels.
 */
export function findPackageDirs(root: string, maxDepth = 6): string[] {
  const found: string[] = [];
  const walk = (rel: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === 'package.json')) found.push(rel);
    if (depth >= maxDepth) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      walk(rel ? join(rel, entry.name) : entry.name, depth + 1);
    }
  };
  walk('', 0);
  return found.sort();
}
