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
    // 3 sequential checks would take ~1.5s; concurrent should be ~0.5s plus
    // process-spawn overhead. We assert well under the sequential floor.
    const start = Date.now();
    const results = await runPreflight([
      { name: 'a', command: 'sleep 0.5' },
      { name: 'b', command: 'sleep 0.5' },
      { name: 'c', command: 'sleep 0.5' },
    ]);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.passed)).toBe(true);
    expect(Date.now() - start).toBeLessThan(1200);
  });
});
