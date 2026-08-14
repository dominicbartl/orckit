import { dirname, join } from 'node:path';
import { statSync } from 'node:fs';

/**
 * Resolved IDE deep-link descriptor. Serialized into the web snapshot so the
 * browser knows file references can be opened in the IDE and can render the
 * right tooltip. The actual opening is done server-side: the dashboard POSTs to
 * orckit's `/api/open`, which runs the IDE's command-line launcher
 * (`<command> --line N --column C <file>`).
 *
 * This works with any JetBrains IDE that has a command-line launcher installed
 * (Tools → "Create Command-Line Launcher") — no JetBrains Toolbox and no
 * bundled-plugin requirement, unlike the `jetbrains://` scheme (needs Toolbox)
 * or the built-in HTTP server's `/api/file` (needs the IDE Remote Control
 * plugin since 2024.2).
 */
export interface IdeLink {
  /** The IDE's command-line launcher, e.g. `webstorm`. */
  command: string;
  /**
   * Absolute project root (the directory containing `.idea`). Files under it
   * open in the IDE; files outside it open in the OS default application.
   */
  root: string;
}

export interface DetectIdeOptions {
  /** The IDE's command-line launcher. Defaults to `webstorm`. */
  command?: string;
}

/**
 * Walk up from `startDir` looking for a `.idea` directory. If found, the project
 * is a JetBrains project and we return an {@link IdeLink} whose `root` is the
 * directory containing `.idea`; otherwise null (no `.idea` → nothing to link).
 */
export function detectIde(startDir: string, opts: DetectIdeOptions = {}): IdeLink | null {
  const ideaDir = findIdeaDir(startDir);
  if (!ideaDir) return null;
  return { command: opts.command ?? 'webstorm', root: dirname(ideaDir) };
}

/** Find the nearest ancestor directory (inclusive) containing a `.idea` dir. */
function findIdeaDir(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, '.idea');
    if (isDirectory(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
