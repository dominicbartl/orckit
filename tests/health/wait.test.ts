import { describe, expect, it } from 'vitest';
import { HealthTimeoutError, waitForReady } from '../../src/health/wait.js';
import type { HealthProbe } from '../../src/health/checks.js';

function probeThatTurnsReadyAfter(
  attempts: number,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): HealthProbe & { count: number } {
  let count = 0;
  const probe: HealthProbe & { count: number } = {
    count: 0,
    intervalMs: opts.intervalMs ?? 10,
    timeoutMs: opts.timeoutMs ?? 1000,
    async check() {
      count++;
      probe.count = count;
      return count >= attempts ? { ok: true } : { ok: false, reason: `attempt ${count}` };
    },
  };
  return probe;
}

describe('waitForReady', () => {
  it('resolves once probe returns ok', async () => {
    const probe = probeThatTurnsReadyAfter(3);
    await waitForReady(probe);
    expect(probe.count).toBeGreaterThanOrEqual(3);
  });

  it('throws HealthTimeoutError after timeout', async () => {
    const probe = probeThatTurnsReadyAfter(999, { intervalMs: 50, timeoutMs: 150 });
    await expect(waitForReady(probe)).rejects.toBeInstanceOf(HealthTimeoutError);
  });

  it('invokes onAttempt for each attempt', async () => {
    const seen: number[] = [];
    await waitForReady(probeThatTurnsReadyAfter(2), {
      onAttempt: (attempt) => seen.push(attempt),
    });
    expect(seen[0]).toBe(1);
    expect(seen[seen.length - 1]).toBeGreaterThanOrEqual(2);
  });

  it('honors abort signal', async () => {
    const controller = new AbortController();
    const probe = probeThatTurnsReadyAfter(999, { intervalMs: 50, timeoutMs: 5000 });
    setTimeout(() => controller.abort(), 100);
    await expect(waitForReady(probe, { signal: controller.signal })).rejects.toThrow(/abort/);
  });
});
