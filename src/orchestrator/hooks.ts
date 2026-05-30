import { execa } from 'execa';
import type { HookConfig } from '../config/schema.js';
import { mergeEnv } from '../util/env.js';
import { bindLineStream } from '../util/line-stream.js';

export type HookKind = 'pre_start' | 'post_start' | 'pre_stop' | 'post_stop';

export interface HookContext {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  /**
   * Optional line sink. When provided, the hook's stdout/stderr is streamed
   * line-by-line as it runs (so a reporter can pipe it live) instead of being
   * buffered and discarded. The failure path still captures stderr for the
   * thrown HookError regardless.
   */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
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

  const sub = execa('bash', ['-c', command], {
    cwd: ctx.cwd ?? process.cwd(),
    env: mergeEnv(ctx.env ?? {}),
    timeout: ctx.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
    reject: false,
    // Stream when a sink is given so output can be piped live; otherwise let
    // execa buffer it (the failure path reads result.stderr below).
    buffer: !ctx.onLine,
  });

  // When streaming we still need stderr for the HookError, so collect it as it
  // flows past the sink.
  const stderrLines: string[] = [];
  if (ctx.onLine) {
    sub.stdout?.setEncoding('utf-8');
    sub.stderr?.setEncoding('utf-8');
    bindLineStream(sub.stdout, (line) => ctx.onLine!(line, 'stdout'));
    bindLineStream(sub.stderr, (line) => {
      stderrLines.push(line);
      ctx.onLine!(line, 'stderr');
    });
  }

  const result = await sub;

  if (result.exitCode !== 0) {
    const stderr = ctx.onLine ? stderrLines.join('\n') : (result.stderr ?? '');
    throw new HookError(hook, command, result.exitCode ?? null, stderr);
  }
}
