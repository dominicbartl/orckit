import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { IdeTool } from '../config/schema.js';

/**
 * Resolved IDE deep-link descriptor. Serialized into the web snapshot so the
 * browser can turn file references in process output into `jetbrains://` links
 * that open the file at a line in the user's running IDE.
 *
 * The fields mirror the JetBrains Toolbox reference URL scheme (TBX-3965):
 *   jetbrains://<toolTag>/navigate/reference?project=<project>&path=<rel>:<line>:<col>
 */
export interface IdeLink {
  /** Toolbox toolTag, e.g. `web-storm` / `idea` / `pycharm`. */
  toolTag: string;
  /** IDE project name (the name the IDE shows in its title bar). */
  project: string;
  /** Absolute project root — so absolute paths in output can be made relative. */
  root: string;
}

/**
 * Map orckit's friendly `ide.tool` values to JetBrains Toolbox toolTags.
 * Source: the Toolbox reference URL scheme (TBX-3965).
 */
const TOOL_TAGS: Record<IdeTool, string> = {
  webstorm: 'web-storm',
  intellij: 'idea',
  pycharm: 'pycharm',
  phpstorm: 'php-storm',
  goland: 'goland',
  rubymine: 'rubymine',
  clion: 'clion',
  rider: 'rd',
  rustrover: 'rustrover',
  datagrip: 'datagrip',
};

export interface DetectIdeOptions {
  /** Friendly tool name from config; selects the toolTag. Defaults to webstorm. */
  tool?: IdeTool;
  /** Override the IDE project name (otherwise derived from `.idea`). */
  project?: string;
}

/**
 * Walk up from `startDir` looking for a `.idea` directory and, if found, build
 * an {@link IdeLink}. Returns null when no `.idea` is found at or above
 * `startDir` (the project isn't a JetBrains project, so there's nothing to
 * link to).
 *
 * The `.idea` folder is shared across every JetBrains IDE and can't reliably
 * tell WebStorm from IntelliJ, so the toolTag comes from config (`ide.tool`,
 * default WebStorm) rather than from inspecting the folder.
 */
export function detectIde(startDir: string, opts: DetectIdeOptions = {}): IdeLink | null {
  const ideaDir = findIdeaDir(startDir);
  if (!ideaDir) return null;
  const root = dirname(ideaDir);
  return {
    toolTag: TOOL_TAGS[opts.tool ?? 'webstorm'],
    project: opts.project ?? ideaProjectName(ideaDir, root),
    root,
  };
}

/** Find the nearest ancestor directory (inclusive) containing a `.idea` dir. */
function findIdeaDir(startDir: string): string | null {
  let dir = startDir;
  // Stop at the filesystem root: parsePath(dir).root === dir there.
  for (;;) {
    const candidate = join(dir, '.idea');
    if (isDirectory(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The IDE project name: the contents of `.idea/.name` when present (IntelliJ
 * writes it when the project name differs from the folder), otherwise the
 * project root's basename — which is what the IDE defaults to.
 */
function ideaProjectName(ideaDir: string, root: string): string {
  const nameFile = join(ideaDir, '.name');
  if (existsSync(nameFile)) {
    try {
      const name = readFileSync(nameFile, 'utf-8').trim();
      if (name) return name;
    } catch {
      // fall through to basename
    }
  }
  return basename(root) || root;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
