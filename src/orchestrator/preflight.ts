import { execa } from 'execa';
import type { PreflightCheck } from '../config/schema.js';

export interface PreflightResult {
  name: string;
  passed: boolean;
  durationMs: number;
  stderr?: string;
  onFail?: string;
}

const PREFLIGHT_TIMEOUT_MS = 30_000;

export async function runPreflight(checks: readonly PreflightCheck[]): Promise<PreflightResult[]> {
  return Promise.all(checks.map(runSingle));
}

async function runSingle(check: PreflightCheck): Promise<PreflightResult> {
  const start = Date.now();
  try {
    const result = await execa('bash', ['-c', check.command], {
      timeout: PREFLIGHT_TIMEOUT_MS,
      reject: false,
    });
    const passed = result.exitCode === 0;
    return {
      name: check.name,
      passed,
      durationMs: Date.now() - start,
      stderr: passed ? undefined : result.stderr || result.stdout || `exit ${result.exitCode}`,
      onFail: passed ? undefined : check.on_fail,
    };
  } catch (err) {
    return {
      name: check.name,
      passed: false,
      durationMs: Date.now() - start,
      stderr: (err as Error).message,
      onFail: check.on_fail,
    };
  }
}

export class PreflightError extends Error {
  constructor(public readonly failures: PreflightResult[]) {
    super(`preflight failed: ${failures.map((f) => f.name).join(', ')}`);
    this.name = 'PreflightError';
  }
}
