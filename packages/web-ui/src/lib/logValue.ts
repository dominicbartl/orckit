import type { LogProp, LogValue, ParsedLogEntry } from './types';

/**
 * Helpers over the server's `LogValue` trees (src/logs/inspect-parse.ts) and
 * parsed log entries: a one-line preview, search text, JSON export, and the
 * well-known request fields the entry rows show as chips.
 */

/** Best-effort JSON for "copy as JSON" — mirrors `toJson` on the server. */
export function toJson(v: LogValue): unknown {
  switch (v.kind) {
    case 'string':
      return v.value;
    case 'number': {
      if (v.text.endsWith('n')) return v.text;
      const n = Number(v.text);
      return Number.isFinite(n) && !Object.is(n, -0) ? n : v.text;
    }
    case 'boolean':
      return v.value;
    case 'null':
      return null;
    case 'undefined':
      return undefined;
    case 'date':
    case 'special':
      return v.text;
    case 'array':
      return v.items.map(toJson);
    case 'map':
      return Object.fromEntries(
        v.pairs.map((p) => {
          const key = toJson(p.key);
          return [typeof key === 'string' ? key : JSON.stringify(key), toJson(p.value)];
        }),
      );
    case 'object': {
      const obj = Object.fromEntries(v.props.map((p) => [p.key, toJson(p.value)]));
      if (!v.items?.length) return obj;
      return v.props.length ? { ...obj, '[[items]]': v.items.map(toJson) } : v.items.map(toJson);
    }
  }
}

/** A scalar as `util.inspect` would print it: strings single-quoted. */
export function scalarText(v: LogValue): string {
  switch (v.kind) {
    case 'string':
      return `'${v.value.replace(/\n/g, '\\n')}'`;
    case 'number':
    case 'date':
    case 'special':
      return v.text;
    case 'boolean':
      return String(v.value);
    case 'null':
      return 'null';
    case 'undefined':
      return 'undefined';
    case 'object':
      return v.props.length || v.items?.length ? '{…}' : '{}';
    case 'array':
      return `[${v.items.length}]`;
    case 'map':
      return `Map(${v.pairs.length})`;
  }
}

/**
 * A one-line preview like `{ restaurantId: 'linden', status: 404, … }`:
 * nested containers collapse to `{…}` / `[n]`, and it stops at `max` chars.
 */
export function previewValue(
  v: LogValue,
  opts: { max?: number; omit?: ReadonlySet<string> } = {},
): string {
  const max = opts.max ?? 140;
  if (v.kind !== 'object' && v.kind !== 'array' && v.kind !== 'map')
    return clip(scalarText(v), max);
  const parts: string[] =
    v.kind === 'object'
      ? [
          ...v.props
            .filter((p) => !opts.omit?.has(p.key))
            .map((p) => `${p.key}: ${scalarText(p.value)}`),
          ...(v.items ?? []).map(scalarText),
        ]
      : v.kind === 'array'
        ? v.items.map(scalarText)
        : v.pairs.map((p) => `${scalarText(p.key)} => ${scalarText(p.value)}`);
  if (parts.length === 0) return v.kind === 'array' ? '[]' : '{}';
  const [open, close] = v.kind === 'array' ? ['[', ']'] : ['{', '}'];
  let out = `${open} `;
  for (let i = 0; i < parts.length; i++) {
    const next = (i > 0 ? ', ' : '') + parts[i];
    if (out.length + next.length + 2 > max) return `${out}${i > 0 ? ', ' : ''}… ${close}`;
    out += next;
  }
  return `${out} ${close}`;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Every key and scalar in a tree, space-joined — what free-text search matches. */
export function valueSearchText(v: LogValue): string {
  const out: string[] = [];
  const walk = (node: LogValue) => {
    switch (node.kind) {
      case 'string':
        out.push(node.value);
        return;
      case 'object':
        if (node.tag) out.push(node.tag);
        for (const p of node.props) {
          out.push(p.key);
          walk(p.value);
        }
        node.items?.forEach(walk);
        return;
      case 'array':
        node.items.forEach(walk);
        for (const p of node.props ?? []) {
          out.push(p.key);
          walk(p.value);
        }
        return;
      case 'map':
        for (const p of node.pairs) {
          walk(p.key);
          walk(p.value);
        }
        return;
      default:
        out.push(scalarText(node));
    }
  };
  walk(v);
  return out.join(' ');
}

const searchCache = new WeakMap<ParsedLogEntry, string>();

/** Lower-cased text an entry matches free-text search against (cached per entry). */
export function entrySearchText(entry: ParsedLogEntry): string {
  let text = searchCache.get(entry);
  if (text === undefined) {
    const parts: string[] = [entry.fn ?? ''];
    if (entry.kind === 'execution') parts.push(`${entry.durationMs}ms`);
    else {
      parts.push(entry.message, entry.stack ?? '');
      if (entry.kind === 'log') {
        parts.push(entry.handler ?? '', entry.context ?? '');
        if (entry.value) parts.push(valueSearchText(entry.value));
      } else parts.push(entry.emulator ?? '');
    }
    text = parts.join('\n').toLowerCase();
    searchCache.set(entry, text);
  }
  return text;
}

/** A top-level field of an object value. */
export function propOf(v: LogValue | undefined, key: string): LogValue | undefined {
  if (v?.kind !== 'object') return undefined;
  return v.props.find((p: LogProp) => p.key === key)?.value;
}

export function numberProp(v: LogValue | undefined, key: string): number | undefined {
  const field = propOf(v, key);
  if (field?.kind !== 'number') return undefined;
  const n = Number(field.text);
  return Number.isFinite(n) ? n : undefined;
}

export function stringProp(v: LogValue | undefined, key: string): string | undefined {
  const field = propOf(v, key);
  return field?.kind === 'string' ? field.value : undefined;
}

/** An HTTP status in a request log's fields, when it has one. */
export function entryStatus(entry: ParsedLogEntry): number | undefined {
  if (entry.kind !== 'log') return undefined;
  const status = numberProp(entry.value, 'status') ?? numberProp(entry.value, 'statusCode');
  return status !== undefined && status >= 100 && status <= 599 ? status : undefined;
}

export type StatusClass = '2xx' | '3xx' | '4xx' | '5xx';
export const STATUS_CLASSES: StatusClass[] = ['2xx', '3xx', '4xx', '5xx'];

export function statusClass(status: number): StatusClass | undefined {
  const c = `${Math.floor(status / 100)}xx`;
  return (STATUS_CLASSES as string[]).includes(c) ? (c as StatusClass) : undefined;
}

/**
 * Request fields the entry row shows as chips (and leaves out of the preview).
 * `controller` / `handler` are covered by the handler label itself.
 */
export const CHIP_KEYS: ReadonlySet<string> = new Set([
  'method',
  'status',
  'statusCode',
  'latencyMs',
  'durationMs',
  'route',
  'path',
  'url',
  'controller',
  'handler',
]);

/** `europe-west1-api` → `api`: the region prefix Firebase puts on every function id. */
export function shortFunctionName(fn: string): string {
  return fn.replace(/^[a-z]+(?:-[a-z]+)*\d+-/, '');
}

/** `14:02:11.204` in local time. */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** `4.4 ms`, `99.6 ms`, `1.24 s`. */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(1) : Math.round(ms * 10) / 10} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}
