import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MERGE_GAP_MS,
  createFirebaseLogAssembler,
  type FirebaseLogBundle,
  type FirebaseLogEntry,
  type UserLogEntry,
} from '../../src/logs/firebase.js';
import { toJson } from '../../src/logs/inspect-parse.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/firebase-logging');
const FIXTURE_FILES = readdirSync(FIXTURES).filter((f) => f.endsWith('.jsonl'));

function readFixture(file: string): FirebaseLogBundle[] {
  return readFileSync(join(FIXTURES, file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as FirebaseLogBundle);
}

/** Feed every bundle, then flush — what the tracker does once a replay goes quiet. */
function assemble(bundles: FirebaseLogBundle[]): FirebaseLogEntry[] {
  const a = createFirebaseLogAssembler();
  return [...bundles.flatMap((b) => a.push(b)), ...a.flush()];
}

const logs = (entries: FirebaseLogEntry[]) =>
  entries.filter((e): e is UserLogEntry => e.kind === 'log');

// ── Synthetic bundles, shaped like the recorded ones ────────────────────────

function meta(fn: string | undefined, message: string) {
  return {
    emulator: { name: 'functions' },
    ...(fn && { function: { name: fn } }),
    message,
  };
}

function user(fn: string | undefined, ts: number, text: string, parsed: unknown = text) {
  const message = `>  ${text}`;
  return {
    level: 'info',
    timestamp: ts,
    message,
    data: { user: parsed, metadata: meta(fn, message) },
  };
}

function sys(fn: string | undefined, ts: number, message: string, level = 'info') {
  return { level, timestamp: ts, message, data: { metadata: meta(fn, message) } };
}

const begin = (fn: string, ts: number) => sys(fn, ts, `Beginning execution of "${fn}"`);
const finish = (fn: string, ts: number, ms: number) => sys(fn, ts, `Finished "${fn}" in ${ms}ms`);

describe('createFirebaseLogAssembler — recorded fixtures', () => {
  it.each(FIXTURE_FILES)('%s: every bundle lands in exactly one entry', (file) => {
    const bundles = readFixture(file);
    const entries = assemble(bundles);

    const userLines = bundles.filter((b) => b.data.user !== undefined).length;
    const finished = bundles.filter((b) => b.message.startsWith('Finished "')).length;
    const begun = bundles.filter((b) => b.message.startsWith('Beginning execution of')).length;
    const system = bundles.length - userLines - finished - begun;

    expect(logs(entries).reduce((n, e) => n + e.lineCount, 0)).toBe(userLines);
    expect(entries.filter((e) => e.kind === 'execution')).toHaveLength(finished);
    expect(entries.filter((e) => e.kind === 'system')).toHaveLength(system);
    // Emitted in timeline order with no gaps: holding back never reorders.
    expect(entries.map((e) => e.id)).toEqual(entries.map((_, i) => i));
  });

  it('turns a concurrent burst into executions, Nest warnings and request logs', () => {
    const entries = assemble(readFixture('concurrent-burst-404.jsonl'));
    const executions = entries.filter((e) => e.kind === 'execution');
    expect(executions).toHaveLength(10);
    expect(executions.every((e) => e.fn === 'europe-west1-api' && e.durationMs > 0)).toBe(true);

    const nest = logs(entries).filter((e) => e.context);
    expect(nest).toHaveLength(8);
    for (const e of nest) {
      expect(e).toMatchObject({ level: 'warn', context: 'AllExceptionsFilter', lineCount: 1 });
      expect(e.pid).toBeGreaterThan(0);
      expect(e.message).toMatch(/^Document not found at GET \/widget\/restaurants/);
    }

    const requests = logs(entries).filter((e) => e.handler === 'WidgetController.getBootstrapData');
    expect(requests).toHaveLength(8);
    const probes = requests.map((e) => {
      expect(e).toMatchObject({ level: 'info', lineCount: 9 });
      expect(e.message).toBe('WidgetController.getBootstrapData executed');
      const fields = toJson(e.value!) as { status: number; pathParams: { restaurantId: string } };
      expect(fields.status).toBe(404);
      return fields.pathParams.restaurantId;
    });
    expect(probes.sort()).toEqual(Array.from({ length: 8 }, (_, i) => `probe-${i + 1}`));

    const webhook = logs(entries).find((e) => e.handler === 'PaymentController.processWebhook');
    expect(toJson(webhook!.value!)).toMatchObject({ method: 'POST', status: 400 });
  });

  it('keeps a Stripe error dump as one error entry with its stack split off', () => {
    const entries = logs(assemble(readFixture('migration-with-stripe-error.jsonl')));
    const stripe = entries.find((e) => e.message.startsWith('Failed to add product tags'))!;
    expect(stripe).toMatchObject({
      fn: 'europe-west1-core_v2-migrateHttp',
      level: 'error',
      lineCount: 79,
    });
    expect(stripe.message).toMatch(/StripeInvalidRequestError: No such subscription/);
    expect(stripe.message).not.toContain('\n    at ');
    expect(stripe.stack!.split('\n')).toHaveLength(3);
    expect(stripe.stack).toMatch(/^\s+at generateV1Error /);
    expect(toJson(stripe.value!)).toMatchObject({
      type: 'StripeInvalidRequestError',
      statusCode: 404,
    });
    // The other migration steps around it stay one-line info entries.
    expect(entries.filter((e) => e.message.startsWith('Upgrading from')).length).toBeGreaterThan(5);
    expect(entries.filter((e) => e.level === 'error')).toHaveLength(2);
  });

  it('reads emulator start-up as system entries', () => {
    const entries = assemble(readFixture('startup.jsonl'));
    expect(entries.every((e) => e.kind === 'system')).toBe(true);
    const system = entries.filter((e) => e.kind === 'system');

    // CLI prefixes become the emulator label.
    const outdated = system.find((e) => e.message.startsWith('package.json indicates'))!;
    expect(outdated).toMatchObject({ level: 'warn', emulator: 'functions' });

    // Multi-line load errors keep the message and split off the stack.
    const loadError = system.find((e) => e.message.startsWith('Error: Cannot find module'))!;
    expect(loadError.level).toBe('error');
    expect(loadError.message).toContain('Require stack:');
    expect(loadError.stack).toMatch(/^\s+at /);

    // Banners and `Serving at port 8779\n` lose their surrounding newlines.
    expect(system.every((e) => !/^\n|\n$/.test(e.message))).toBe(true);
    expect(system.find((e) => e.message.includes('All emulators ready'))!.message).toMatch(/^┌/);
  });

  it('keeps interleaved trigger functions apart', () => {
    const entries = assemble(readFixture('background-triggers.jsonl'));
    const fns = new Set(entries.map((e) => e.fn).filter(Boolean));
    expect(fns.size).toBeGreaterThanOrEqual(10);
    expect(logs(entries).every((e) => e.lineCount === 1)).toBe(true);
  });

  it('maps structured logger lines by severity (synthetic fixture)', () => {
    const entries = logs(assemble(readFixture('structured-logger.synthetic.jsonl')));
    expect(entries.map((e) => [e.level, e.message])).toEqual([
      ['info', 'Order placed'],
      ['warn', 'Slow query'],
      ['error', 'Payment failed Error: card_declined'],
    ]);
    expect(toJson(entries[0]!.value!)).toEqual({ orderId: 'o_123', items: 2, total: 49.5 });
    expect(entries[2]!.value).toBeUndefined();
    expect(entries[2]!.stack).toMatch(/^\s+at /);
  });
});

describe('createFirebaseLogAssembler — merging', () => {
  it('holds a later entry back until an earlier one closes', () => {
    const a = createFirebaseLogAssembler();
    expect(a.push(user('A', 0, 'dump {'))).toEqual([]);
    expect(a.push(user('B', 1, 'hello from B'))).toEqual([]);
    expect(a.push(user('A', 2, '  a: 1'))).toEqual([]);
    // A's closing brace finishes it; B is still collecting lines.
    const out = a.push(user('A', 3, '}'));
    expect(out).toMatchObject([{ id: 0, fn: 'A', message: 'dump', lineCount: 3 }]);
    expect(a.flush()).toMatchObject([{ id: 1, fn: 'B', message: 'hello from B' }]);
  });

  it('does not merge across the gap', () => {
    const a = createFirebaseLogAssembler();
    a.push(user('A', 0, 'first'));
    const out = a.push(user('A', MERGE_GAP_MS + 1, '  indented, but much later'));
    expect(out).toMatchObject([{ message: 'first', lineCount: 1 }]);
    expect(a.flush()).toMatchObject([{ lineCount: 1 }]);
  });

  it('closes on the next unindented line of the same function', () => {
    const a = createFirebaseLogAssembler();
    a.push(user('A', 0, 'one'));
    expect(a.push(user('A', 1, 'two'))).toMatchObject([{ message: 'one' }]);
  });

  it('closes on a same-function system line, but not inside an open object', () => {
    const a = createFirebaseLogAssembler();
    a.push(user('A', 0, 'plain line'));
    expect(a.push(finish('A', 1, 5))).toMatchObject([
      { kind: 'log', message: 'plain line' },
      { kind: 'execution', durationMs: 5 },
    ]);

    a.push(user('A', 2, 'obj {'));
    expect(a.push(finish('A', 3, 6))).toEqual([]);
    const out = a.push(user('A', 4, '}'));
    expect(out).toMatchObject([
      { kind: 'log', message: 'obj', lineCount: 2 },
      { kind: 'execution', durationMs: 6 },
    ]);
  });

  it('ignores brackets inside quoted strings', () => {
    const a = createFirebaseLogAssembler();
    a.push(user('A', 0, "path '/a/{id}' is {"));
    a.push(user('A', 1, "  note: 'unbalanced [ in string',"));
    const out = a.push(user('A', 2, '}'));
    expect(out).toHaveLength(1);
    expect(toJson((out[0] as UserLogEntry).value!)).toEqual({ note: 'unbalanced [ in string' });
  });

  it('treats a lone JSON line as structured but not a parsed fragment of a dump', () => {
    const a = createFirebaseLogAssembler();
    a.push(user('A', 0, 'list ['));
    // `  2` JSON-parses to the number 2; it is still a continuation line.
    a.push(user('A', 1, '  1,', '  1,'));
    a.push(user('A', 2, '  2', 2));
    const [dump] = a.push(user('A', 3, ']')) as UserLogEntry[];
    expect(toJson(dump!.value!)).toEqual([1, 2]);

    const [json] = [
      ...a.push(user('A', 4, '{"id":"x","n":1}', { id: 'x', n: 1 })),
      ...a.flush(),
    ] as UserLogEntry[];
    expect(json).toMatchObject({ level: 'info', message: '', lineCount: 1 });
    expect(toJson(json!.value!)).toEqual({ id: 'x', n: 1 });
  });

  it('merges an error message with its indented stack', () => {
    const a = createFirebaseLogAssembler();
    a.push(user('A', 0, 'TypeError: nope'));
    a.push(user('A', 1, '    at handler (src/app.ts:3:9)'));
    const [e] = a.flush() as UserLogEntry[];
    expect(e).toMatchObject({ level: 'error', message: 'TypeError: nope', lineCount: 2 });
    expect(e!.stack).toBe('    at handler (src/app.ts:3:9)');
  });
});

describe('createFirebaseLogAssembler — fields', () => {
  it('counts executions in flight', () => {
    const a = createFirebaseLogAssembler();
    a.push(begin('A', 0));
    a.push(begin('A', 1));
    a.push(begin('B', 2));
    expect([...a.inFlight()]).toEqual([
      ['A', 2],
      ['B', 1],
    ]);
    a.push(finish('A', 3, 1));
    a.push(finish('B', 4, 1));
    expect([...a.inFlight()]).toEqual([['A', 1]]);
    // A stray Finished (history cut mid-execution) never goes negative.
    a.push(finish('C', 5, 1));
    expect(a.inFlight().has('C')).toBe(false);
  });

  it('parses every Nest log level, including the unpadded VERBOSE', () => {
    const levels = { LOG: 'info', WARN: 'warn', ERROR: 'error', DEBUG: 'debug', VERBOSE: 'debug' };
    for (const [nest, level] of Object.entries(levels)) {
      const a = createFirebaseLogAssembler();
      const padded = nest.padStart(7);
      a.push(user('A', 0, `[Nest] 42  - 11/19/2026, 9:00:00 AM ${padded} [Svc] did a thing`));
      expect(a.flush()).toMatchObject([{ level, context: 'Svc', pid: 42, message: 'did a thing' }]);
    }
  });

  it('finds the handler from fields first, then a leading Class.method token', () => {
    const entries = assemble([
      user('A', 0, "done { controller: 'Orders', handler: 'create' }"),
      user('A', 1, 'Billing.charge took 3ms'),
      user('A', 2, 'res.toJSON failed'),
    ]);
    expect(logs(entries).map((e) => e.handler)).toEqual([
      'Orders.create',
      'Billing.charge',
      undefined,
    ]);
  });

  it('attributes lines without function metadata to no function', () => {
    const [log, system] = assemble([
      user(undefined, 0, 'orphan line'),
      { level: 'info', timestamp: 1, message: 'i  emulators: ready\n', data: {} },
    ]);
    expect(log).not.toHaveProperty('fn');
    expect(system).toMatchObject({ kind: 'system', emulator: 'emulators', message: 'ready' });
  });
});
