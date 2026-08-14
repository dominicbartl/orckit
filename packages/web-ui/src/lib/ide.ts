import type { IdeLink } from './types';

/**
 * Resolve a file reference from process output into an **absolute** path so
 * orckit's `/api/open` can hand it to the IDE launcher. Resolution:
 *   - absolute `file` → used as-is
 *   - relative `file` + `baseDir` (the emitting process's working dir) → joined
 *     onto `baseDir`
 *   - relative `file`, no `baseDir` → passed through (best effort)
 *
 * `baseDir` matters because a process logs paths relative to its OWN `cwd`.
 */
export function resolveFilePath(file: string, baseDir?: string): string {
  return isAbsolute(file) ? file : baseDir ? joinPath(baseDir, file) : file;
}

/**
 * A run of plain text, or a file reference to render as a link. `file` is the
 * resolved (absolute, when possible) path; `line`/`col` are 1-based positions.
 */
export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; file: string; line?: number; col?: number };

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
 * it (see {@link resolveFilePath}).
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
      file: resolveFilePath(file!, baseDir),
      line: line ? Number(line) : undefined,
      col: col ? Number(col) : undefined,
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
