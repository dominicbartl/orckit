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
 * A run of plain text, a file reference to render as an IDE link, or an
 * http(s) URL to render as a regular anchor. `file` is the resolved (absolute,
 * when possible) path; `line`/`col` are 1-based positions.
 */
export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; file: string; line?: number; col?: number }
  | { kind: 'url'; text: string; href: string };

/**
 * http(s) URL: scheme, then everything up to whitespace or a quote/bracket
 * that can't appear unescaped in a URL. Trailing sentence punctuation is
 * trimmed afterwards by {@link trimUrl}.
 */
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/g;

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
 * Split a line of output into plain-text, URL and file-link segments. http(s)
 * URLs are always linkified; file refs only when `ide` is non-null. `baseDir`
 * is the emitting process's working directory; relative file refs resolve
 * against it (see {@link resolveFilePath}).
 */
export function linkifyOutput(text: string, ide: IdeLink | null, baseDir?: string): Segment[] {
  if (!text) return [{ kind: 'text', text }];

  // URLs first, so a path inside one (`http://host/src/app.ts`) is never
  // mistaken for a file ref; the gaps between them go through linkifyFiles.
  const segments: Segment[] = [];
  let last = 0;
  // Reset lastIndex — the regex is shared (global) across calls.
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) != null) {
    const href = trimUrl(m[0]);
    if (m.index > last) segments.push(...linkifyFiles(text.slice(last, m.index), ide, baseDir));
    segments.push({ kind: 'url', text: href, href });
    last = m.index + href.length;
    URL_RE.lastIndex = last;
  }
  if (last < text.length) segments.push(...linkifyFiles(text.slice(last), ide, baseDir));
  return segments;
}

/**
 * Drop trailing punctuation that almost always belongs to the surrounding
 * prose (`see http://x.dev/docs.`), and a closing `)`/`]` only when it has no
 * opening partner inside the URL (`(http://x.dev)` vs `…/Foo_(bar)`).
 */
function trimUrl(url: string): string {
  for (;;) {
    const ch = url.at(-1);
    if (ch && '.,;:!?'.includes(ch)) {
      url = url.slice(0, -1);
    } else if (
      (ch === ')' && count(url, '(') < count(url, ')')) ||
      (ch === ']' && count(url, '[') < count(url, ']'))
    ) {
      url = url.slice(0, -1);
    } else {
      return url;
    }
  }
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

/** File-ref pass of {@link linkifyOutput}, over a URL-free run of text. */
function linkifyFiles(text: string, ide: IdeLink | null, baseDir?: string): Segment[] {
  if (!ide) return [{ kind: 'text', text }];

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
