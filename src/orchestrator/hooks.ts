import { execa } from 'execa';
import type { HookConfig } from '../config/schema.js';
import { mergeEnv } from '../util/env.js';

export type HookKind = 'pre_start' | 'post_start' | 'pre_stop' | 'post_stop';

export interface HookContext {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export class HookError extends Error {
  constructor(
    public readonly hook: HookKind,
    public readonly command: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(`${hook} hook failed (exit ${exitCode ?? '?'}): ${command}`);
    this.name = 'HookError';
  }
}

const DEFAULT_HOOK_TIMEOUT_MS = 60_000;

export async function runHook(
  hook: HookKind,
  hooks: HookConfig | undefined,
  ctx: HookContext = {},
): Promise<void> {
  const command = hooks?.[hook];
  if (!command) return;

  const result = await execa('bash', ['-c', command], {
    cwd: ctx.cwd ?? process.cwd(),
    env: mergeEnv(ctx.env ?? {}),
    timeout: ctx.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
    reject: false,
  });

  if (result.exitCode !== 0) {
    throw new HookError(hook, command, result.exitCode ?? null, result.stderr ?? '');
  }
}
