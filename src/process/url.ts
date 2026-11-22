import type { ProcessConfig } from '../config/schema.js';
import { stripAnsi } from './parsers.js';

/**
 * A process's root URL — where it can be opened in a browser. Resolution, in
 * order of precedence:
 *
 * 1. `url: <string>` in the config — used as-is, never replaced.
 * 2. `url: { pattern }` — captured from output; nothing until it matches.
 * 3. Unset — detected from well-known dev-server output (`detectUrl`), with the
 *    origin of an `http` ready check shown until then.
 * 4. `url: false` — no URL at all.
 *
 * Everything here is pure; the orchestrator owns the per-process state.
 */

/** Pulls a URL out of one output line, or null. */
export type UrlMatcher = (line: string) => string | null;

// Each pattern's first group is the URL. Deliberately anchored on the label
// dev servers print in front of their *browser* URL, so an API that merely
// logs `connecting to http://…` never claims a URL it doesn't serve.
const DETECTORS: RegExp[] = [
  // Firebase: `i  View Emulator UI at http://127.0.0.1:4000/` (inside a box).
  /\bView Emulator UI at\s+(https?:\/\/\S+)/i,
  // Angular ≥17, Vite, Next, CRA: `➜  Local:   http://localhost:4200/`;
  // webpack-dev-server: `[webpack-dev-server] Loopback: http://localhost:8080/`.
  /\b(?:Local|Loopback):\s+(https?:\/\/\S+)/i,
  // Angular ≤16: `… open your browser on http://localhost:4200/ **`.
  /\bopen your browser on\s+(https?:\/\/\S+)/i,
];

/** The browser URL a well-known dev server announces on this line, or null. */
export function detectUrl(line: string): string | null {
  const clean = stripAnsi(line);
  for (const re of DETECTORS) {
    const match = re.exec(clean);
    if (match?.[1]) {
      const url = normalizeUrl(match[1]);
      if (url) return url;
    }
  }
  return null;
}

/** The URL a config shows before (or without) any output. */
export function initialUrl(config: Pick<ProcessConfig, 'url' | 'ready'>): string | null {
  if (config.url === false) return null;
  if (typeof config.url === 'string') return normalizeUrl(config.url);
  if (config.url) return null; // pattern: wait for the line
  if (config.ready?.type === 'http') {
    const url = parseUrl(config.ready.url);
    return url ? normalizeUrl(url.origin) : null;
  }
  return null;
}

/**
 * The output matcher for a config, or null when the URL can't change at
 * runtime (static or disabled).
 */
export function urlMatcher(config: Pick<ProcessConfig, 'url'>): UrlMatcher | null {
  if (config.url === false || typeof config.url === 'string') return null;
  if (!config.url) return detectUrl;
  const re = new RegExp(config.url.pattern);
  return (line) => {
    const match = re.exec(stripAnsi(line));
    if (!match) return null;
    return normalizeUrl(match[1] ?? match[0]);
  };
}

/**
 * Trim the punctuation and box-drawing that trail a URL in prose, swap
 * wildcard bind addresses (which a browser can't open) for `localhost`, and
 * drop a bare trailing `/`. Null when what's left isn't an http(s) URL.
 */
export function normalizeUrl(raw: string): string | null {
  const url = parseUrl(trimTrailing(raw.trim()));
  if (!url) return null;
  if (url.hostname === '0.0.0.0' || url.hostname === '[::]') url.hostname = 'localhost';
  return formatUrl(url);
}

const TRAILING_PUNCT = /[\s│┃|*,.;:!?'"`>]/u;
const CLOSER_TO_OPENER: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/**
 * Strip trailing prose punctuation. A closing bracket goes only when it's
 * unbalanced — `(see http://x/)` loses its `)`, `http://[::1]` keeps its `]`.
 */
function trimTrailing(s: string): string {
  for (;;) {
    const last = s.at(-1);
    if (last === undefined) return s;
    const opener = CLOSER_TO_OPENER[last];
    const unbalanced = opener !== undefined && count(s, opener) < count(s, last);
    if (!TRAILING_PUNCT.test(last) && !unbalanced) return s;
    s = s.slice(0, -1);
  }
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '[::]']);

/**
 * Point a loopback URL at `host` instead — inside a sandbox, `localhost:4200`
 * is only reachable from the Mac as `<sandbox-host>:4200`. URLs on any other
 * host are returned unchanged.
 */
export function rewriteLoopbackHost(raw: string, host: string): string {
  const url = parseUrl(raw);
  if (!url || !LOOPBACK.has(url.hostname)) return raw;
  url.hostname = host;
  return formatUrl(url);
}

function parseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function formatUrl(url: URL): string {
  const href = url.href;
  return url.pathname === '/' && !url.search && !url.hash ? href.slice(0, -1) : href;
}
