/**
 * Hook execution system
 */

import { execa } from 'execa';
import type { ProcessHooks, GlobalHooks } from '../../types/index.js';

/**
 * Hook execution result
 */
export interface HookResult {
  success: boolean;
  output?: string;
  error?: Error;
  duration: number;
}

/**
 * Execute a hook command
 *
 * @param command - Command to execute
 * @param cwd - Working directory
 * @param timeout - Timeout in milliseconds
 * @returns Hook execution result
 */
export async function executeHook(
  command: string,
  cwd?: string,
  timeout: number = 30000
): Promise<HookResult> {
  const startTime = Date.now();

  try {
    const result = await execa('bash', ['-c', command], {
      cwd: cwd ?? process.cwd(),
      timeout,
      all: true,
    });

    return {
      success: true,
      output: result.all,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Execute process hooks in sequence
 *
 * @param hooks - Process hooks configuration
 * @param event - Hook event type
 * @param cwd - Working directory
 * @param onHookStart - Callback when hook starts
 * @param onHookComplete - Callback when hook completes
 */
export async function executeProcessHooks(
  hooks: ProcessHooks | undefined,
  event: 'pre_start' | 'post_start' | 'pre_stop' | 'post_stop',
  cwd?: string,
  onHookStart?: (event: string, command: string) => void,
  onHookComplete?: (event: string, result: HookResult) => void
): Promise<void> {
  if (!hooks) {
    return;
  }

  const command = hooks[event];
  if (!command) {
    return;
  }

  if (onHookStart) {
    onHookStart(event, command);
  }

  const result = await executeHook(command, cwd);

  if (onHookComplete) {
    onHookComplete(event, result);
  }

  if (!result.success) {
    throw new Error(`Hook '${event}' failed: ${result.error?.message}`);
  }
}

/**
 * Execute global hooks
 *
 * @param hooks - Global hooks configuration
 * @param event - Hook event type
 * @param onHookStart - Callback when hook starts
 * @param onHookComplete - Callback when hook completes
 */
export async function executeGlobalHooks(
  hooks: GlobalHooks | undefined,
  event: 'pre_start_all' | 'post_start_all' | 'pre_stop_all' | 'post_stop_all',
  onHookStart?: (event: string, command: string) => void,
  onHookComplete?: (event: string, result: HookResult) => void
): Promise<void> {
  if (!hooks) {
    return;
  }

  const command = hooks[event];
  if (!command) {
    return;
  }

  if (onHookStart) {
    onHookStart(event, command);
  }

  const result = await executeHook(command);

  if (onHookComplete) {
    onHookComplete(event, result);
  }

  if (!result.success) {
    throw new Error(`Global hook '${event}' failed: ${result.error?.message}`);
  }
}
