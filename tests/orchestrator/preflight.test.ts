import { describe, expect, it } from 'vitest';
import { runPreflight } from '../../src/orchestrator/preflight.js';

describe('runPreflight', () => {
  it('returns empty results for an empty list', async () => {
    expect(await runPreflight([])).toEqual([]);
  });

  it('marks passing commands as passed', async () => {
    const [r] = await runPreflight([{ name: 'noop', command: 'true' }]);
    expect(r?.passed).toBe(true);
    expect(r?.name).toBe('noop');
  });

  it('marks failing commands as failed and captures hint', async () => {
    const [r] = await runPreflight([
      { name: 'check', command: 'echo nope 1>&2 && exit 1', on_fail: 'fix it' },
    ]);
    expect(r?.passed).toBe(false);
    expect(r?.stderr).toContain('nope');
    expect(r?.onFail).toBe('fix it');
  });

  it('runs checks concurrently', async () => {
    const start = Date.now();
    const results = await runPreflight([
      { name: 'a', command: 'sleep 0.3' },
      { name: 'b', command: 'sleep 0.3' },
      { name: 'c', command: 'sleep 0.3' },
    ]);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.passed)).toBe(true);
    expect(Date.now() - start).toBeLessThan(900);
  });
});
