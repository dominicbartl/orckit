import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  fromJson,
  parseInspect,
  parseLogText,
  toJson,
  type LogValue,
} from '../../src/logs/inspect-parse.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/firebase-logging');

/** The user-log texts of a fixture, grouped into console.log calls (ANSI stripped). */
function fixtureEntries(file: string): string[] {
  const entries: { fn: string; lines: string[] }[] = [];
  for (const raw of readFileSync(join(FIXTURES, file), 'utf8').split('\n')) {
    if (!raw) continue;
    const bundle = JSON.parse(raw);
    const user = bundle.data?.user;
    if (typeof user !== 'string') continue;
    const fn = bundle.data.metadata?.function?.name ?? '';
    const text = user.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
    const last = entries.at(-1);
    // inspect continuation lines are indented; only the closing bracket isn't.
    if (last && last.fn === fn && /^[\s}\]]/.test(text)) last.lines.push(text);
    else entries.push({ fn, lines: [text] });
  }
  return entries.map((e) => e.lines.join('\n'));
}

function entryStartingWith(file: string, prefix: string): string {
  const entry = fixtureEntries(file).find((e) => e.startsWith(prefix));
  if (!entry) throw new Error(`no entry starting with ${prefix} in ${file}`);
  return entry;
}

/** Parse `inspect(v)` and require success. */
function roundTrip(v: unknown, opts: Parameters<typeof inspect>[1] = {}): LogValue {
  const text = inspect(v, opts);
  const parsed = parseInspect(text);
  if (!parsed) throw new Error(`failed to parse:\n${text}`);
  return parsed;
}

function prop(v: LogValue, key: string): LogValue {
  if (v.kind !== 'object' && v.kind !== 'array') throw new Error(`not a container: ${v.kind}`);
  const found = v.props?.find((p) => p.key === key);
  if (!found) throw new Error(`no prop ${key}`);
  return found.value;
}

describe('parseInspect — round-trips real util.inspect output', () => {
  const plain = {
    controller: 'WidgetController',
    latencyMs: 99,
    ok: true,
    nothing: null,
    ratio: -1.5e-7,
    nested: { a: [1, 2, { b: 'c' }], empty: {}, none: [] },
    'content-type': 'application/json',
    'a b': 1,
    $dollar: 2,
    ünï: 'cödé ✓ 🔥',
    quotes: `it's "both" \`kinds\``,
    single: "it's",
    escapes: 'tab\there\nnewline \\ back \u0001 ctrl \x1B[33m ansi',
    long: 'x'.repeat(300),
    multiline: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n'),
  };

  it.each([
    ['default layout', {}],
    ['forced multi-line', { breakLength: 0 }],
    ['single line', { breakLength: Infinity }],
    ['compact off', { compact: false }],
  ] as const)('recovers plain data exactly (%s)', (_label, opts) => {
    expect(toJson(roundTrip(plain, { depth: Infinity, ...opts }))).toEqual(plain);
  });

  it('recovers long numeric arrays laid out in columns', () => {
    const nums = Array.from({ length: 90 }, (_, i) => i * 7);
    expect(toJson(roundTrip(nums, { maxArrayLength: Infinity }))).toEqual(nums);
  });

  it('reads scalars on their own', () => {
    expect(parseInspect("'hi'")).toEqual({ kind: 'string', value: 'hi' });
    expect(parseInspect('42')).toEqual({ kind: 'number', text: '42' });
    expect(parseInspect('undefined')).toEqual({ kind: 'undefined' });
  });
});

describe('parseInspect — annotations', () => {
  it('tags null-prototype objects (the pathParams shape)', () => {
    const v = roundTrip(Object.assign(Object.create(null), { restaurantId: 'linden' }));
    expect(v).toEqual({
      kind: 'object',
      tag: '[Object: null prototype]',
      props: [{ key: 'restaurantId', value: { kind: 'string', value: 'linden' } }],
    });
    expect(roundTrip(Object.create(null))).toEqual({
      kind: 'object',
      tag: '[Object: null prototype]',
      props: [],
    });
  });

  it('tags class instances', () => {
    class Foo {
      a = 1;
    }
    expect(roundTrip(new Foo())).toMatchObject({ kind: 'object', tag: 'Foo' });
  });

  it('reads Map and Set', () => {
    const map = roundTrip(
      new Map<unknown, unknown>([
        ['a', 1],
        [{ k: 1 }, 'obj'],
      ]),
    );
    expect(map).toMatchObject({ kind: 'map', tag: 'Map(2)' });
    expect(map.kind === 'map' && map.pairs).toHaveLength(2);
    expect(toJson(map)).toEqual({ a: 1, '{"k":1}': 'obj' });
    expect(roundTrip(new Map())).toEqual({ kind: 'map', tag: 'Map(0)', pairs: [] });

    const set = roundTrip(new Set([1, 'two']));
    expect(set).toMatchObject({ kind: 'array', tag: 'Set(2)' });
    expect(toJson(set)).toEqual([1, 'two']);
  });

  it('links <ref *N> to [Circular *N]', () => {
    const circ: Record<string, unknown> = { name: 'x' };
    circ.self = circ;
    const v = roundTrip(circ);
    expect(v).toMatchObject({ kind: 'object', ref: 1 });
    expect(prop(v, 'self')).toEqual({ kind: 'special', text: '[Circular *1]' });
  });

  it('keeps depth truncation and "more items" visible', () => {
    const v = roundTrip({ a: { b: { c: { d: 1 } } }, arr: [[[[1]]]] });
    // inspect prints `arr: [ [ [Array] ] ]` — two levels, then the marker.
    expect(toJson(v)).toEqual({ a: { b: { c: '[Object]' } }, arr: [['[Array]']] });

    const many = roundTrip(Array.from({ length: 120 }, (_, i) => i));
    expect(many).toMatchObject({ kind: 'array', more: 20 });
    expect(many.kind === 'array' && many.items).toHaveLength(100);
  });

  it('reads sparse arrays and named array extras', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(toJson(roundTrip([1, , , 4]))).toEqual([1, '<2 empty items>', 4]);
    const arr: unknown[] & { extra?: string } = [1, 2];
    arr.extra = 'y';
    expect(roundTrip(arr)).toEqual({
      kind: 'array',
      items: [
        { kind: 'number', text: '1' },
        { kind: 'number', text: '2' },
      ],
      props: [{ key: 'extra', value: { kind: 'string', value: 'y' } }],
    });
  });

  it('turns functions, classes, symbols and getters into specials', () => {
    const v = roundTrip({
      f() {},
      h: async function named() {},
      k: class K {},
      s: Symbol('sym'),
      [Symbol('key')]: 1,
      get g() {
        return 1;
      },
    });
    expect(toJson(v)).toEqual({
      f: '[Function: f]',
      h: '[AsyncFunction: named]',
      k: '[class K]',
      s: 'Symbol(sym)',
      '[Symbol(key)]': 1,
      g: '[Getter]',
    });
  });

  it('keeps unusual numbers as printed', () => {
    const v = roundTrip({ nan: NaN, inf: -Infinity, neg0: -0, big: 10n, e: 1e21 });
    expect(v.kind === 'object' && v.props.map((p) => p.value)).toEqual([
      { kind: 'number', text: 'NaN' },
      { kind: 'number', text: '-Infinity' },
      { kind: 'number', text: '-0' },
      { kind: 'number', text: '10n' },
      { kind: 'number', text: '1e+21' },
    ]);
    expect(toJson(v)).toEqual({ nan: 'NaN', inf: '-Infinity', neg0: '-0', big: '10n', e: 1e21 });
  });

  it('reads dates, regexes, buffers, typed arrays, promises and weak collections', () => {
    const v = roundTrip({
      d: new Date(0),
      re: /a[,\]/]+c/gi,
      u: undefined,
      buf: Buffer.from('hi'),
      u8: new Uint8Array([1, 2]),
      p: Promise.resolve(3),
      wm: new WeakMap(),
    });
    expect(prop(v, 'd')).toEqual({ kind: 'date', text: '1970-01-01T00:00:00.000Z' });
    expect(prop(v, 're')).toEqual({ kind: 'special', text: '/a[,\\]/]+c/gi' });
    expect(prop(v, 'u')).toEqual({ kind: 'undefined' });
    expect(prop(v, 'buf')).toEqual({ kind: 'special', text: '<Buffer 68 69>' });
    expect(prop(v, 'u8')).toMatchObject({ kind: 'array', tag: 'Uint8Array(2)' });
    expect(prop(v, 'p')).toEqual({
      kind: 'object',
      tag: 'Promise',
      props: [],
      items: [{ kind: 'number', text: '3' }],
    });
    expect(prop(v, 'wm')).toMatchObject({
      kind: 'object',
      tag: 'WeakMap',
      items: [{ kind: 'special', text: '<items unknown>' }],
    });
  });

  it('reads a nested error with its stack and own properties', () => {
    const err = Object.assign(new Error('boom, bad'), { code: 'E_BAD' });
    const v = roundTrip({ err, after: 1 });
    const e = prop(v, 'err');
    expect(e.kind).toBe('object');
    expect(e.kind === 'object' && e.tag).toMatch(/^Error: boom, bad\n\s+at /);
    expect(toJson(e)).toEqual({ code: 'E_BAD' });
    expect(prop(v, 'after')).toEqual({ kind: 'number', text: '1' });
  });

  it('reads a nested error without properties, before another field', () => {
    const v = roundTrip({ err: new TypeError('nope, really'), after: 1 });
    const e = prop(v, 'err');
    expect(e.kind === 'special' && e.text).toMatch(/^TypeError: nope, really\n\s+at /);
    expect(e.kind === 'special' && e.text.endsWith(',')).toBe(false);
    expect(prop(v, 'after')).toEqual({ kind: 'number', text: '1' });
  });

  it('reads an error inside an array as a value, not a key', () => {
    const v = roundTrip([new Error('in array')]);
    expect(v.kind === 'array' && v.items[0]?.kind).toBe('special');
    expect(v.kind === 'array' && v.props).toBeUndefined();
  });

  it('joins strings wrapped with + (older Node line-wrapping)', () => {
    expect(parseInspect("{\n  s: 'line1\\n' +\n    'line2'\n}")).toEqual({
      kind: 'object',
      props: [{ key: 's', value: { kind: 'string', value: 'line1\nline2' } }],
    });
  });
});

describe('parseInspect — fails closed', () => {
  it.each([
    ['unterminated object', '{ a: 1'],
    ['unterminated string', "{ a: 'x }"],
    ['unpadded braces', '{a: 1}'],
    ['bare word in a plain object', '{ restaurantId }'],
    ['trailing garbage', '{ a: 1 } extra'],
    ['empty', ''],
  ])('%s → null', (_label, text) => {
    expect(parseInspect(text)).toBeNull();
  });

  it('never throws on truncated fixture entries', () => {
    const entries = readdirSync(FIXTURES)
      .filter((f) => f.endsWith('.jsonl'))
      .flatMap(fixtureEntries)
      .filter((e) => e.includes('\n'));
    for (const entry of entries) {
      for (let cut = 1; cut < entry.length; cut += Math.max(1, Math.floor(entry.length / 25))) {
        expect(() => parseLogText(entry.slice(0, cut))).not.toThrow();
        expect(() => parseInspect(entry.slice(cut))).not.toThrow();
      }
    }
  });
});

describe('parseLogText', () => {
  it('splits the request log into message and fields (fixture)', () => {
    const r = parseLogText(
      entryStartingWith('concurrent-burst-404.jsonl', 'WidgetController.getBootstrapData'),
    );
    expect(r.message).toBe('WidgetController.getBootstrapData executed');
    expect(toJson(r.value!)).toEqual({
      controller: 'WidgetController',
      latencyMs: expect.any(Number),
      route: '/widget/restaurants/:restaurantId/bootstrap',
      method: 'GET',
      handler: 'getBootstrapData',
      status: 404,
      pathParams: { restaurantId: expect.stringMatching(/^probe-\d$/) },
    });
    expect(prop(r.value!, 'pathParams')).toMatchObject({ tag: '[Object: null prototype]' });
  });

  it('separates a Stripe error dump from its stack (fixture)', () => {
    const r = parseLogText(
      entryStartingWith('migration-with-stripe-error.jsonl', 'Failed to add product tags'),
    );
    expect(r.message).toMatch(/^Failed to add product tags .*StripeInvalidRequestError: No such/);
    expect(r.message).toMatch(/\n\s+at processTicksAndRejections \(.*\)$/);
    const fields = toJson(r.value!) as Record<string, unknown>;
    expect(fields.type).toBe('StripeInvalidRequestError');
    expect(fields.statusCode).toBe(404);
    expect((fields.raw as Record<string, unknown>).message).toBe(
      "No such subscription: 'dev-sub-linden'",
    );
    expect(prop(prop(r.value!, 'raw'), 'headers').kind).toBe('object');
  });

  it('parses every multi-line object entry in the fixtures', () => {
    const blocks = readdirSync(FIXTURES)
      .filter((f) => f.endsWith('.jsonl'))
      .flatMap(fixtureEntries)
      .filter((e) => e.includes('\n') && /\n[}\]]$/.test(e));
    expect(blocks.length).toBeGreaterThan(20);
    for (const block of blocks) expect(parseLogText(block).value, block).not.toBeNull();
  });

  it('leaves Nest logger lines as text even though they contain braces (fixture)', () => {
    const nest = entryStartingWith('concurrent-burst-404.jsonl', '[Nest]');
    expect(nest).toContain('{restaurantId}');
    expect(parseLogText(nest)).toEqual({ message: nest, value: null });
  });

  it('leaves plain one-line logs as text (fixture)', () => {
    for (const text of fixtureEntries('background-triggers.jsonl').filter(
      (e) => !e.includes('\n'),
    )) {
      expect(parseLogText(text).value).toBeNull();
    }
  });

  it('reads JSON — whole text or trailing a message', () => {
    expect(parseLogText('{"a":1,"b":[true,null]}')).toEqual({
      message: '',
      value: fromJson({ a: 1, b: [true, null] }),
    });
    expect(parseLogText('payload {"id":"x"}')).toEqual({
      message: 'payload',
      value: fromJson({ id: 'x' }),
    });
  });

  it('only treats containers as values', () => {
    expect(parseLogText('handler is [Function: f]').value).toBeNull();
    expect(parseLogText('count 42').value).toBeNull();
    expect(parseLogText('wrapped [ 1, 2 ]').value).toMatchObject({ kind: 'array' });
  });

  it('takes the last of two logged objects as the value', () => {
    expect(parseLogText('{ a: 1 } { b: 2 }')).toEqual({
      message: '{ a: 1 }',
      value: { kind: 'object', props: [{ key: 'b', value: { kind: 'number', text: '2' } }] },
    });
  });

  it('reads a top-level <ref *1> object', () => {
    const circ: Record<string, unknown> = {};
    circ.me = circ;
    expect(parseLogText(`state ${inspect(circ)}`).value).toMatchObject({ kind: 'object', ref: 1 });
  });
});

describe('fromJson / toJson', () => {
  it('round-trips a structured logger payload (synthetic fixture)', () => {
    const payloads = readFileSync(join(FIXTURES, 'structured-logger.synthetic.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l).data?.user)
      .filter((u) => u && typeof u === 'object');
    expect(payloads).toHaveLength(3);
    for (const p of payloads) expect(toJson(fromJson(p))).toEqual(p);
  });

  it('keeps object-with-items content when exporting', () => {
    const v = roundTrip(Promise.resolve({ x: 1 }));
    expect(toJson(v)).toEqual([{ x: 1 }]);
  });
});
