import { describe, expect, it } from 'vitest';
import { OutputBuffer } from '../../src/process/output.js';

describe('OutputBuffer', () => {
  it('stores lines up to capacity', () => {
    const buf = new OutputBuffer(3);
    buf.push('a', 'stdout');
    buf.push('b', 'stdout');
    buf.push('c', 'stdout');
    buf.push('d', 'stdout');
    expect(buf.recent().map((l) => l.text)).toEqual(['b', 'c', 'd']);
  });

  it('returns the most recent n lines', () => {
    const buf = new OutputBuffer(10);
    for (const c of 'abcde') buf.push(c, 'stdout');
    expect(buf.recent(2).map((l) => l.text)).toEqual(['d', 'e']);
  });

  it('records stream tags', () => {
    const buf = new OutputBuffer(10);
    buf.push('hi', 'stderr');
    expect(buf.recent()[0]?.stream).toBe('stderr');
  });

  it('suppresses lines matching suppress patterns', () => {
    const buf = new OutputBuffer(10, { suppress: ['\\[debug\\]'], highlight: [], include: [] });
    expect(buf.push('[debug] noisy', 'stdout')).toBeNull();
    expect(buf.push('important', 'stdout')).not.toBeNull();
    expect(buf.recent().map((l) => l.text)).toEqual(['important']);
  });

  it('filters when include patterns are set', () => {
    const buf = new OutputBuffer(10, { suppress: [], highlight: [], include: ['^ERROR'] });
    expect(buf.push('hello', 'stdout')).toBeNull();
    expect(buf.push('ERROR: bad', 'stdout')).not.toBeNull();
  });

  it('tags matching lines with highlight color', () => {
    const buf = new OutputBuffer(10, {
      suppress: [],
      highlight: [{ pattern: 'WARN', color: 'yellow' }],
      include: [],
    });
    buf.push('plain', 'stdout');
    buf.push('WARN: heads up', 'stdout');
    expect(buf.recent()[0]?.highlight).toBeUndefined();
    expect(buf.recent()[1]?.highlight).toBe('yellow');
  });

  it('can be cleared', () => {
    const buf = new OutputBuffer(10);
    buf.push('x', 'stdout');
    buf.clear();
    expect(buf.size()).toBe(0);
  });
});
