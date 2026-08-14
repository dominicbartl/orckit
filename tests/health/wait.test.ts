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

  it('rejects when the abort lands mid-check, even if that check then reports ready', async () => {
    // The shutdown race: a stop lands while a probe is already in flight and the
    // probe comes back ok. Without the post-await re-check the cancelled startup
    // would continue into "ready" for a process that is being torn down.
    const controller = new AbortController();
    const attempts: number[] = [];
    const probe: HealthProbe = {
      intervalMs: 10,
      timeoutMs: 5000,
      async check() {
        controller.abort(); // the stop lands *during* the check
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true };
      },
    };
    await expect(
      waitForReady(probe, {
        signal: controller.signal,
        onAttempt: (attempt) => attempts.push(attempt),
      }),
    ).rejects.toThrow(/abort/);
    // The cancelled attempt must not even be reported as an attempt.
    expect(attempts).toEqual([]);
  });
});
