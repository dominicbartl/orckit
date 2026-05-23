import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { attachRepl, parseReplLine, type ReplHandlers } from '../../src/reporter/repl.js';

describe('parseReplLine', () => {
  it.each([
    ['r', { kind: 'retry', targets: [], cascade: true }],
    ['r backend', { kind: 'retry', targets: ['backend'], cascade: true }],
    ['r api web', { kind: 'retry', targets: ['api', 'web'], cascade: true }],
    ['r!', { kind: 'retry', targets: [], cascade: false }],
    ['r! backend', { kind: 'retry', targets: ['backend'], cascade: false }],
    ['s', { kind: 'status' }],
    ['status', { kind: 'status' }],
    ['q', { kind: 'quit' }],
    ['quit', { kind: 'quit' }],
    ['exit', { kind: 'quit' }],
    ['?', { kind: 'help' }],
    ['h', { kind: 'help' }],
    ['help', { kind: 'help' }],
    ['', { kind: 'noop' }],
    ['   ', { kind: 'noop' }],
  ])('parses %p', (input, expected) => {
    expect(parseReplLine(input)).toEqual(expected);
  });

  it('returns error for unknown commands', () => {
    const result = parseReplLine('foobar');
    expect(result.kind).toBe('error');
  });

  it('trims surrounding whitespace', () => {
    expect(parseReplLine('  r backend  ')).toEqual({
      kind: 'retry',
      targets: ['backend'],
      cascade: true,
    });
  });

  it('collapses multiple spaces between tokens', () => {
    expect(parseReplLine('r   api    web')).toEqual({
      kind: 'retry',
      targets: ['api', 'web'],
      cascade: true,
    });
  });
});

describe('attachRepl', () => {
  function makeHandlers(): ReplHandlers & {
    calls: { retry: Array<[string[], boolean]>; status: number; quit: number };
  } {
    const calls = { retry: [] as Array<[string[], boolean]>, status: 0, quit: 0 };
    return {
      calls,
      retry: vi.fn(async (targets: string[], cascade: boolean) => {
        calls.retry.push([targets, cascade]);
      }),
      status: vi.fn(() => {
        calls.status++;
      }),
      quit: vi.fn(async () => {
        calls.quit++;
      }),
    };
  }

  it('returns null when input is not a TTY (default)', () => {
    const input = new PassThrough();
    const output = new PassThrough();
    expect(attachRepl(makeHandlers(), { input, output })).toBeNull();
  });

  it('attaches when requireTty is false', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const handlers = makeHandlers();

    const repl = attachRepl(handlers, { input, output, requireTty: false });
    expect(repl).not.toBeNull();

    input.write('r backend\n');
    await new Promise((r) => setImmediate(r));
    input.write('s\n');
    await new Promise((r) => setImmediate(r));
    input.write('r!\n');
    await new Promise((r) => setImmediate(r));

    expect(handlers.calls.retry).toEqual([
      [['backend'], true],
      [[], false],
    ]);
    expect(handlers.calls.status).toBe(1);

    repl!.detach();
  });

  it('quit handler is invoked on `q`', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const handlers = makeHandlers();

    attachRepl(handlers, { input, output, requireTty: false });

    input.write('q\n');
    await new Promise((r) => setImmediate(r));

    expect(handlers.calls.quit).toBe(1);
  });

  it('help prints to output', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', (b: Buffer) => chunks.push(b.toString()));

    const repl = attachRepl(makeHandlers(), { input, output, requireTty: false });
    input.write('?\n');
    await new Promise((r) => setImmediate(r));

    const text = chunks.join('');
    expect(text).toContain('retry failed processes');
    expect(text).toContain('quit');

    repl!.detach();
  });

  it('unknown command prints a warning', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', (b: Buffer) => chunks.push(b.toString()));

    const repl = attachRepl(makeHandlers(), { input, output, requireTty: false });
    input.write('zzz\n');
    await new Promise((r) => setImmediate(r));

    expect(chunks.join('')).toContain('unknown command');
    repl!.detach();
  });

  it('printHint writes message above prompt', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', (b: Buffer) => chunks.push(b.toString()));

    const repl = attachRepl(makeHandlers(), { input, output, requireTty: false });
    repl!.printHint('  ✗ backend failed');
    await new Promise((r) => setImmediate(r));

    expect(chunks.join('')).toContain('backend failed');
    repl!.detach();
  });
});
