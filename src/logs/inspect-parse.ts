/**
 * Lenient parser for what Node's `console.log` prints — `util.inspect` output —
 * and for plain JSON, producing a serializable `LogValue` tree a viewer can
 * render with syntax highlighting.
 *
 * Inspect output is not a data format: it is not JSON (unquoted keys, single
 * quotes, `undefined`), it carries annotations (`[Object: null prototype]`,
 * `<ref *1>`, `Map(2)`), and it is lossy (`[Object]` past depth 2, `... 20 more
 * items`). The parser keeps every annotation as a node — a `tag` on containers
 * or a `special` leaf — so nothing the log said is dropped, and it fails closed:
 * anything it can't read whole returns `null` and the caller shows plain text.
 */

/** A `key: value` field of an object, or a named extra on an array. */
export interface LogProp {
  key: string;
  value: LogValue;
}

/** Shared by every container. `tag` is the annotation printed before it. */
interface ContainerBase {
  /** `Foo`, `Map(2)`, `[Object: null prototype]`, `Error: boom\n    at …`. */
  tag?: string;
  /** Set when printed as `<ref *N>` — the target of a later `[Circular *N]`. */
  ref?: number;
  /** Count from a trailing `... N more items` (inspect truncated the list). */
  more?: number;
}

export interface LogObject extends ContainerBase {
  kind: 'object';
  props: LogProp[];
  /** Keyless members: `Promise { 3 }`, `WeakMap { <items unknown> }`. */
  items?: LogValue[];
}

export interface LogArray extends ContainerBase {
  kind: 'array';
  /** Elements; also the members of a `Set(n) { … }`. */
  items: LogValue[];
  /** Named extras: `[ 1, 2, extra: 'y' ]`. */
  props?: LogProp[];
}

export interface LogMap extends ContainerBase {
  kind: 'map';
  pairs: { key: LogValue; value: LogValue }[];
}

export type LogValue =
  | { kind: 'string'; value: string }
  /** Kept as printed so `NaN`, `-0`, `1e+21` and bigints (`10n`) survive JSON. */
  | { kind: 'number'; text: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'null' }
  | { kind: 'undefined' }
  /** A `Date`, which inspect prints bare: `2026-10-21T13:34:06.000Z`. */
  | { kind: 'date'; text: string }
  /**
   * Anything inspect prints as an opaque token: `[Function: f]`, `[class K]`,
   * `[Circular *1]`, `[Object]`, `[Getter]`, `Symbol(x)`, `/re/g`,
   * `<Buffer 68 69>`, `<2 empty items>`, an `Error: …` with its stack.
   */
  | { kind: 'special'; text: string }
  | LogObject
  | LogArray
  | LogMap;

export interface ParsedLogText {
  /** Text before the value (`WidgetController.getBootstrapData executed`), trimmed. */
  message: string;
  /** The trailing object/array, or null when the text holds none. */
  value: LogValue | null;
}

/** Texts above this are left as plain text — a viewer can't use a tree that big anyway. */
const MAX_TEXT = 256 * 1024;
/** Value start positions tried per text before giving up. */
const MAX_CANDIDATES = 50;
const MAX_DEPTH = 200;

/**
 * Split a log text into its message and a trailing structured value — the
 * shape of `console.log('msg', obj)` — or a whole-text JSON object/array.
 * Only a container counts as a value: `handler is [Function: f]` stays text.
 *
 * The value must start the text or follow whitespace (that is how
 * `console.log` joins its arguments) and must run to the end of the text, so a
 * path like `/accounts/{accountId}/x` is never mistaken for an object.
 */
export function parseLogText(text: string): ParsedLogText {
  const plain: ParsedLogText = { message: text, value: null };
  if (text.length > MAX_TEXT) return plain;

  let tried = 0;
  for (let i = 0; i < text.length && tried < MAX_CANDIDATES; i++) {
    const ch = text[i];
    const isStart = ch === '{' || ch === '[' || (ch === '<' && text.startsWith('<ref *', i));
    if (!isStart || (i > 0 && !/\s/.test(text[i - 1]!))) continue;
    tried++;
    const value = parseContainerAt(text, i);
    if (value) return { message: text.slice(0, i).trimEnd(), value };
  }
  return plain;
}

/** Parse a whole text as exactly one inspect value (scalar or container). */
export function parseInspect(text: string): LogValue | null {
  if (text.length > MAX_TEXT) return null;
  const c: Cursor = { s: text, i: 0 };
  try {
    const value = parseValue(c, 0);
    skipWs(c);
    return c.i === c.s.length ? value : null;
  } catch (err) {
    if (err === FAIL) return null;
    throw err;
  }
}

/** Convert a JSON value (e.g. a structured log line already parsed upstream). */
export function fromJson(v: unknown): LogValue {
  if (v === null) return { kind: 'null' };
  if (v === undefined) return { kind: 'undefined' };
  if (typeof v === 'string') return { kind: 'string', value: v };
  if (typeof v === 'number') return { kind: 'number', text: String(v) };
  if (typeof v === 'boolean') return { kind: 'boolean', value: v };
  if (Array.isArray(v)) return { kind: 'array', items: v.map(fromJson) };
  if (typeof v === 'object') {
    return {
      kind: 'object',
      props: Object.entries(v).map(([key, value]) => ({ key, value: fromJson(value) })),
    };
  }
  return { kind: 'special', text: String(v) };
}

/**
 * Best-effort JSON for "copy as JSON". Lossy where JSON can't express inspect:
 * specials, dates and non-finite numbers become their printed text, Map keys
 * are stringified, and annotations (`tag`, `ref`, `more`) are dropped.
 */
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

// ── Parser ────────────────────────────────────────────────────────────────

interface Cursor {
  s: string;
  i: number;
}

/** Thrown to unwind a failed parse; only ever caught inside this module. */
const FAIL = Symbol('inspect-parse-fail');
function fail(): never {
  throw FAIL;
}

function parseContainerAt(text: string, start: number): LogValue | null {
  if (text[start] !== '<') {
    // Strict JSON is the common structured-logger shape; JSON.parse is exact and fast.
    try {
      const json: unknown = JSON.parse(text.slice(start));
      if (json !== null && typeof json === 'object') return fromJson(json);
    } catch {
      // not JSON — fall through to the inspect grammar
    }
  }
  const c: Cursor = { s: text, i: start };
  try {
    const value = parseValue(c, 0);
    skipWs(c);
    if (c.i !== c.s.length) return null;
    return value.kind === 'object' || value.kind === 'array' || value.kind === 'map' ? value : null;
  } catch (err) {
    if (err === FAIL) return null;
    throw err;
  }
}

const NUMBER_RE = /-?(?:\d+(?:\.\d+)?(?:e[+-]?\d+)?n?|Infinity)|NaN/y;
const KEYWORD_RE = /(?:true|false|null|undefined)(?![\w$])/y;
const ISO_DATE_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/y;
const IDENT_KEY_RE = /[A-Za-z_$][\w$]*(?=:\s)/y;
/** `Foo `, `Map(2) `, `Uint8Array(2) `, `Foo [Bar] ` directly before `{` or `[`. */
const TAG_RE = /[A-Za-z_$][\w$]*(?:\(\d+\))?(?: \[[^\]\n]+\])? (?=[{[])/y;
/** `TypeError: …`, `StripeInvalidRequestError: …`, `Error [ERR_X]: …`, bare `Error`. */
const ERROR_RE = /(?:[A-Za-z_$][\w$]*)?(?:Error|Exception)(?: \[[^\]\n]+\])?(?=[:\s,}\]]|$)/y;
const STACK_LINE_RE = /\n[ \t]+(?:at |\.\.\. \d+ lines? matching)[^\n]*/y;
const MORE_RE = /\.\.\. (\d+) more (?:items?|properties|propert(?:y|ies)|bytes?)/y;
const REF_RE = /<ref \*(\d+)> /y;

function sticky(re: RegExp, c: Cursor): string | null {
  re.lastIndex = c.i;
  const m = re.exec(c.s);
  if (!m) return null;
  c.i += m[0].length;
  return m[0];
}

function skipWs(c: Cursor): void {
  while (c.i < c.s.length && /\s/.test(c.s[c.i]!)) c.i++;
}

/** True when the cursor sits on a value delimiter (end of a scalar token). */
function atDelimiter(c: Cursor): boolean {
  const ch = c.s[c.i];
  return ch === undefined || /[\s,}\]]/.test(ch);
}

function parseValue(c: Cursor, depth: number): LogValue {
  if (depth > MAX_DEPTH) fail();
  skipWs(c);
  const refText = sticky(REF_RE, c);
  const ref = refText ? Number(refText.slice(6, -2)) : undefined;
  const value = parseBareValue(c, depth);
  if (ref !== undefined) {
    if (value.kind !== 'object' && value.kind !== 'array' && value.kind !== 'map') fail();
    value.ref = ref;
  }
  return value;
}

function parseBareValue(c: Cursor, depth: number): LogValue {
  const ch = c.s[c.i];
  if (ch === undefined) fail();

  if (ch === "'" || ch === '"' || ch === '`') return { kind: 'string', value: parseStrings(c) };
  if (ch === '{') return parseContainer(c, depth, undefined);
  if (ch === '[') {
    const next = c.s[c.i + 1];
    if (next === ']' || (next !== undefined && /\s/.test(next))) {
      return parseContainer(c, depth, undefined);
    }
    // `[Object]`, `[Function: f]`, `[Circular *1]`, or the `[Object: null
    // prototype]` tag of a container that follows.
    const text = readBalanced(c, '[', ']');
    if (c.s[c.i] === ' ' && (c.s[c.i + 1] === '{' || c.s[c.i + 1] === '[')) {
      c.i++;
      return parseContainer(c, depth, text);
    }
    return { kind: 'special', text };
  }
  if (ch === '/') return { kind: 'special', text: readRegex(c) };
  if (ch === '<') return { kind: 'special', text: readBalanced(c, '<', '>') };

  const date = sticky(ISO_DATE_RE, c);
  if (date) {
    if (!atDelimiter(c)) fail();
    return { kind: 'date', text: date };
  }
  const start = c.i;
  const num = sticky(NUMBER_RE, c);
  if (num !== null) {
    if (atDelimiter(c)) return { kind: 'number', text: num };
    c.i = start;
  }
  const kw = sticky(KEYWORD_RE, c);
  if (kw) {
    if (kw === 'true' || kw === 'false') return { kind: 'boolean', value: kw === 'true' };
    return kw === 'null' ? { kind: 'null' } : { kind: 'undefined' };
  }
  if (sticky(ERROR_RE, c) !== null) {
    c.i = start;
    return parseError(c, depth);
  }
  const tag = sticky(TAG_RE, c);
  if (tag) return parseContainer(c, depth, tag.trimEnd());

  // `Symbol(x)` and any other bare token: up to the next delimiter.
  return { kind: 'special', text: readToken(c) };
}

/**
 * An error printed inside an object: its first line, its stack frames, and —
 * when it carries own properties — a `{ … }` block, which becomes a container
 * tagged with the error text. Without this the commas in an error message
 * would end the value early.
 */
function parseError(c: Cursor, depth: number): LogValue {
  const start = c.i;
  const eol = c.s.indexOf('\n', c.i);
  c.i = eol === -1 ? c.s.length : eol;
  while (sticky(STACK_LINE_RE, c) !== null) {
    // consume every stack frame line
  }
  // The last frame line may carry the delimiter of the enclosing container.
  if (c.s[c.i - 1] === ',') c.i--;
  const text = c.s.slice(start, c.i);
  if (text.endsWith(' {')) {
    c.i -= 1;
    return parseContainer(c, depth, text.slice(0, -2));
  }
  // A one-line error without a stack ends where the surrounding container
  // resumes, e.g. `{ err: Error: boom }`.
  if (!text.includes('\n')) {
    c.i = start;
    return { kind: 'special', text: readToken(c) };
  }
  return { kind: 'special', text };
}

function parseContainer(c: Cursor, depth: number, tag: string | undefined): LogValue {
  const open = c.s[c.i];
  const close = open === '{' ? '}' : ']';
  c.i++;
  // inspect always pads: `{ a: 1 }`, `[ 1 ]`, or empty `{}` / `[]`.
  const after = c.s[c.i];
  if (after !== close && (after === undefined || !/\s/.test(after))) fail();

  const props: LogProp[] = [];
  const items: LogValue[] = [];
  const pairs: { key: LogValue; value: LogValue }[] = [];
  let more: number | undefined;
  const allowBare = open === '[' || tag !== undefined;

  for (;;) {
    skipWs(c);
    if (c.s[c.i] === close) {
      c.i++;
      break;
    }
    const moreText = sticky(MORE_RE, c);
    if (moreText) {
      more = Number(/\d+/.exec(moreText)![0]);
    } else {
      // `Error: boom` followed by a stack is a value even though it reads like a key.
      const key = errorAhead(c) ? null : parseKey(c);
      if (key !== null) {
        props.push({ key, value: parseValue(c, depth + 1) });
      } else {
        const value = parseValue(c, depth + 1);
        skipWs(c);
        if (c.s.startsWith('=>', c.i)) {
          c.i += 2;
          pairs.push({ key: value, value: parseValue(c, depth + 1) });
        } else if (allowBare) {
          items.push(value);
        } else {
          fail();
        }
      }
    }
    skipWs(c);
    if (c.s[c.i] === ',') {
      c.i++;
      continue;
    }
    if (c.s[c.i] === close) {
      c.i++;
      break;
    }
    fail();
  }

  const base: ContainerBase = {};
  if (tag !== undefined) base.tag = tag;
  if (more !== undefined) base.more = more;

  if (pairs.length > 0 || (tag !== undefined && /^(?:Weak)?Map\(/.test(tag))) {
    if (props.length > 0 || items.length > 0) fail();
    return { kind: 'map', ...base, pairs };
  }
  if (open === '[' || (tag !== undefined && /^(?:Weak)?Set\(/.test(tag))) {
    const arr: LogArray = { kind: 'array', ...base, items };
    if (props.length > 0) arr.props = props;
    return arr;
  }
  const obj: LogObject = { kind: 'object', ...base, props };
  if (items.length > 0) obj.items = items;
  return obj;
}

/** True when an `…Error: message` line followed by a stack frame starts here. */
function errorAhead(c: Cursor): boolean {
  const start = c.i;
  const isError = sticky(ERROR_RE, c) !== null;
  if (isError) {
    const eol = c.s.indexOf('\n', c.i);
    c.i = eol === -1 ? c.s.length : eol;
  }
  const hasStack = isError && sticky(STACK_LINE_RE, c) !== null;
  c.i = start;
  return hasStack;
}

/** A `key:` followed by whitespace, or null (cursor unchanged) when none is here. */
function parseKey(c: Cursor): string | null {
  const start = c.i;
  const ident = sticky(IDENT_KEY_RE, c);
  if (ident !== null) {
    c.i++; // ':'
    return ident;
  }
  const ch = c.s[c.i];
  try {
    let key: string | null = null;
    if (ch === "'" || ch === '"' || ch === '`') key = readString(c);
    else if (ch === '[' && c.s.startsWith('[Symbol(', c.i)) key = readBalanced(c, '[', ']');
    if (key !== null && c.s[c.i] === ':' && /\s/.test(c.s[c.i + 1] ?? '')) {
      c.i++;
      return key;
    }
  } catch (err) {
    if (err !== FAIL) throw err;
  }
  c.i = start;
  return null;
}

/** One string, or several joined by inspect's line-wrapping `'a' +\n 'b'`. */
function parseStrings(c: Cursor): string {
  let out = readString(c);
  for (;;) {
    const save = c.i;
    skipWs(c);
    if (c.s[c.i] !== '+') {
      c.i = save;
      return out;
    }
    c.i++;
    skipWs(c);
    const ch = c.s[c.i];
    if (ch !== "'" && ch !== '"' && ch !== '`') fail();
    out += readString(c);
  }
}

const ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
};

function readString(c: Cursor): string {
  const quote = c.s[c.i];
  c.i++;
  let out = '';
  for (;;) {
    const ch = c.s[c.i];
    if (ch === undefined || ch === '\n') fail();
    c.i++;
    if (ch === quote) return out;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const esc = c.s[c.i];
    if (esc === undefined) fail();
    c.i++;
    if (esc === 'x') {
      out += String.fromCharCode(parseInt(readHex(c, 2), 16));
    } else if (esc === 'u') {
      if (c.s[c.i] === '{') {
        const end = c.s.indexOf('}', c.i);
        if (end === -1) fail();
        out += String.fromCodePoint(parseInt(c.s.slice(c.i + 1, end), 16));
        c.i = end + 1;
      } else {
        out += String.fromCharCode(parseInt(readHex(c, 4), 16));
      }
    } else {
      out += ESCAPES[esc] ?? esc;
    }
  }
}

function readHex(c: Cursor, n: number): string {
  const hex = c.s.slice(c.i, c.i + n);
  if (!new RegExp(`^[0-9a-fA-F]{${n}}$`).test(hex)) fail();
  c.i += n;
  return hex;
}

/** Text from an opening bracket to its matching close, inclusive. */
function readBalanced(c: Cursor, open: string, close: string): string {
  const start = c.i;
  let depth = 0;
  for (; c.i < c.s.length; c.i++) {
    const ch = c.s[c.i];
    if (ch === '\n') break;
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) {
      c.i++;
      return c.s.slice(start, c.i);
    }
  }
  return fail();
}

function readRegex(c: Cursor): string {
  const start = c.i;
  c.i++;
  let inClass = false;
  for (; c.i < c.s.length; c.i++) {
    const ch = c.s[c.i];
    if (ch === '\n') fail();
    if (ch === '\\') c.i++;
    else if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      c.i++;
      while (c.i < c.s.length && /[a-z]/.test(c.s[c.i]!)) c.i++;
      if (!atDelimiter(c)) fail();
      return c.s.slice(start, c.i);
    }
  }
  return fail();
}

/** A bare token up to the next top-level delimiter, e.g. `Symbol(a, b)`. */
function readToken(c: Cursor): string {
  const start = c.i;
  let parens = 0;
  for (; c.i < c.s.length; c.i++) {
    const ch = c.s[c.i]!;
    if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (parens <= 0 && (ch === ',' || ch === '}' || ch === ']' || ch === '\n')) break;
    else if (parens <= 0 && c.s.startsWith(' =>', c.i)) break;
  }
  const text = c.s.slice(start, c.i).trimEnd();
  if (!text) fail();
  return text;
}
