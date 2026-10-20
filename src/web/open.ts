import { spawn } from 'node:child_process';
import { isAbsolute, relative } from 'node:path';
import type { IdeLink } from './ide.js';

/**
 * Open `file` for the user: inside the IDE project root via the IDE's
 * command-line launcher (`<command> [--line N] [--column C] <file>`), anywhere
 * else via the OS default application, so temp files and generated artifacts
 * don't hijack the IDE. Shared by the web dashboard's `/api/open` and the
 * sandbox's Mac-side open relay. Resolves with what opened it.
 */
export async function openFile(
  ide: IdeLink,
  file: string,
  line: string | null,
  column: string | null,
): Promise<string> {
  if (isUnderRoot(file, ide.root)) {
    await openInIde(ide.command, file, line, column);
    return ide.command;
  }
  const [command, args] = defaultOpenCommand(process.platform, file);
  await spawnDetached(command, args);
  return 'default app';
}

/**
 * Args are passed as an array (no shell), so the browser-supplied `file` can't
 * inject a command.
 */
function openInIde(
  command: string,
  file: string,
  line: string | null,
  column: string | null,
): Promise<void> {
  const args: string[] = [];
  if (line && /^\d+$/.test(line)) args.push('--line', line);
  if (column && /^\d+$/.test(column)) args.push('--column', column);
  args.push(file);
  return spawnDetached(command, args);
}

/**
 * The OS default-open command + args for a file. Exposed for unit testing.
 *   - macOS:   `open <file>`
 *   - Windows: `cmd /c start "" <file>`  (empty title arg avoids quoting issues)
 *   - other:   `xdg-open <file>`
 */
export function defaultOpenCommand(platform: NodeJS.Platform, file: string): [string, string[]] {
  if (platform === 'darwin') return ['open', [file]];
  if (platform === 'win32') return ['cmd', ['/c', 'start', '', file]];
  return ['xdg-open', [file]];
}

/**
 * True when `file` is the project `root` or sits inside it. Pure path math.
 * Exposed for unit testing.
 */
export function isUnderRoot(file: string, root: string): boolean {
  const rel = relative(root, file);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Spawn a detached child, resolving once it has spawned and rejecting if it
 * couldn't be launched (e.g. ENOENT — not on PATH).
 */
function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
