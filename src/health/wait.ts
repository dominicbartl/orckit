import type { HealthProbe, ProbeResult } from './checks.js';

export class HealthTimeoutError extends Error {
  constructor(
    public readonly elapsedMs: number,
    public readonly lastReason: string | undefined,
  ) {
    super(
      `probe did not become ready within ${elapsedMs}ms${lastReason ? ` (last: ${lastReason})` : ''}`,
    );
    this.name = 'HealthTimeoutError';
  }
}

export interface WaitOptions {
  signal?: AbortSignal;
  onAttempt?: (attempt: number, result: ProbeResult) => void;
}

export async function waitForReady(probe: HealthProbe, options: WaitOptions = {}): Promise<void> {
  const deadline = Date.now() + probe.timeoutMs;
  let attempt = 0;
  let lastReason: string | undefined;

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw new Error('health check aborted');
    }
    attempt++;
    const result = await probe.check();
    options.onAttempt?.(attempt, result);
    if (result.ok) return;
    lastReason = result.reason;
    await sleep(probe.intervalMs, options.signal);
  }
  throw new HealthTimeoutError(probe.timeoutMs, lastReason);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
