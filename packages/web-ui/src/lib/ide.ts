import type { IdeLink } from './types';

/**
 * Build a JetBrains Toolbox deep link for a file reference.
 *
 *   jetbrains://<toolTag>/navigate/reference?project=<project>&path=<rel>:<line>:<col>
 *
 * `path` is relative to the IDE project root. Resolution:
 *   - absolute `file` → relativized against `ide.root` (passed through if outside)
 *   - relative `file` + `baseDir` (the emitting process's working dir) →
 *     joined onto `baseDir`, then relativized against `ide.root`
 *   - relative `file`, no `baseDir` → passed through (IDE resolves it against
 *     the project base)
 *
 * `baseDir` matters because a process logs paths relative to its OWN `cwd`,
 * which may be a subdirectory of (or differ from) the IDE project root.
 */
export function buildIdeHref(
  ide: IdeLink,
  file: string,
  line?: number,
  col?: number,
  baseDir?: string,
): string {
  let path = file;
  if (isAbsolute(file)) {
    const rel = relativize(file, ide.root);
    if (rel != null) path = rel;
  } else if (baseDir) {
    const abs = joinPath(baseDir, file);
    path = relativize(abs, ide.root) ?? abs;
  }
  let suffix = '';
  if (line != null) {
    suffix = `:${line}`;
    if (col != null) suffix += `:${col}`;
  }
  const params = `project=${encodeURIComponent(ide.project)}&path=${encodeURIComponent(path + suffix)}`;
  return `jetbrains://${ide.toolTag}/navigate/reference?${params}`;
}

/** A run of plain text, or a file reference that should render as a link. */
export type Segment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

/**
 * Path-like token: a sequence of path chars containing at least one `/` or a
 * leading `./`, ending in a `.<ext>` of 1–6 word chars, optionally followed by
 * a location — `:line`, `:line:col`, or `(line,col)` (the tsc/MSBuild form).
 *
 * Anchored to avoid matching mid-word: must start at the string start or after
 * whitespace, `(`, `[`, `'`, `"`, or `@` (covers stack-trace `(at …)` framing).
 */
const FILE_RE =
  /(^|[\s('"[@])((?:\.{0,2}\/)?(?:[\w.@~-]+\/)+[\w.@~-]+\.[\w]{1,6}|\.{1,2}\/[\w.@~/-]+\.[\w]{1,6})(?::(\d+)(?::(\d+))?|\((\d+),(\d+)\))?/g;

/**
 * Split a line of output into plain-text and file-link segments. When `ide` is
 * null nothing is linkified — the whole line is one text segment. `baseDir` is
 * the emitting process's working directory; relative file refs resolve against
 * it (see {@link buildIdeHref}).
 */
export function linkifyOutput(text: string, ide: IdeLink | null, baseDir?: string): Segment[] {
  if (!ide || !text) return [{ kind: 'text', text }];

  const segments: Segment[] = [];
  let last = 0;
  // Reset lastIndex — the regex is shared (global) across calls.
  FILE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FILE_RE.exec(text)) != null) {
    const [, lead = '', file, colonLine, colonCol, parenLine, parenCol] = m;
    const matchStart = m.index + lead.length;
    const matchEnd = m.index + m[0].length;

    if (matchStart > last) {
      segments.push({ kind: 'text', text: text.slice(last, matchStart) });
    }

    const line = colonLine ?? parenLine;
    const col = colonCol ?? parenCol;
    segments.push({
      kind: 'link',
      text: text.slice(matchStart, matchEnd),
      href: buildIdeHref(
        ide,
        file!,
        line ? Number(line) : undefined,
        col ? Number(col) : undefined,
        baseDir,
      ),
    });
    last = matchEnd;
  }

  if (last < text.length) {
    segments.push({ kind: 'text', text: text.slice(last) });
  }
  return segments;
}

function isAbsolute(p: string): boolean {
  // POSIX absolute or Windows drive path.
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * Join a relative path onto a base directory, resolving `.`/`..` segments.
 * Output uses forward slashes (relativize handles both separators). No
 * filesystem access — pure string math on the two inputs.
 */
function joinPath(base: string, rel: string): string {
  const parts = base.replace(/[\\/]+$/, '').split(/[\\/]/);
  for (const part of rel.split(/[\\/]/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/** Make `file` relative to `root`, or null if it isn't under `root`. */
function relativize(file: string, root: string): string | null {
  const normRoot = root.replace(/[\\/]+$/, '');
  if (file === normRoot) return '';
  const withSep = normRoot + '/';
  if (file.startsWith(withSep)) return file.slice(withSep.length);
  // Windows backslash separator.
  const withBackSep = normRoot + '\\';
  if (file.startsWith(withBackSep)) return file.slice(withBackSep.length).replace(/\\/g, '/');
  return null;
}
