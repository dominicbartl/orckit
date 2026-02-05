/**
 * Test helpers for integration testing runners
 */

import { ProcessRunner } from '../../../src/runners/base.js';

/**
 * Result from running a process
 */
export interface RunnerTestResult {
  success: boolean;
  outputs: string[];
  errors: string[];
  buildComplete?: boolean;
  exitCode?: number;
  signal?: NodeJS.Signals | null;
  events: string[];
}

/**
 * Options for running a process in tests
 */
export interface RunProcessOptions {
  /**
   * Timeout in milliseconds (default: 30000)
   */
  timeout?: number;

  /**
   * Whether to log output to console (default: false)
   */
  logOutput?: boolean;

  /**
   * Expected status patterns after start (default: /building|running/)
   */
  expectedStatus?: RegExp;

  /**
   * Events to track (default: all common events)
   */
  trackEvents?: string[];

  /**
   * Success condition (default: build:complete or exit with code 0)
   */
  successCondition?: 'build:complete' | 'exit:0' | 'custom';

  /**
   * Custom success check function
   */
  customSuccessCheck?: (result: RunnerTestResult) => boolean;
}

/**
 * Run a process runner and capture all output and events
 *
 * @param runner - The process runner to execute
 * @param options - Configuration options
 * @returns Promise with test results
 *
 * @example
 * ```typescript
 * const runner = new BashRunner('test', config);
 * const result = await runProcess(runner, { timeout: 5000 });
 * expect(result.success).toBe(true);
 * expect(result.outputs.join('')).toContain('expected output');
 * ```
 */
export async function runProcess(
  runner: ProcessRunner,
  options: RunProcessOptions = {}
): Promise<RunnerTestResult> {
  const {
    timeout = 30000,
    logOutput = false,
    expectedStatus = /building|running/,
    trackEvents = [
      'build:start',
      'build:progress',
      'build:complete',
      'build:failed',
      'failed',
      'exit',
      'status',
    ],
    successCondition = 'build:complete',
    customSuccessCheck,
  } = options;

  return new Promise((resolve) => {
    const outputs: string[] = [];
    const errors: string[] = [];
    const events: string[] = [];
    let buildComplete = false;
    let exitCode: number | undefined;
    let signal: NodeJS.Signals | null | undefined;

    // Capture stdout
    runner.on('stdout', (data) => {
      if (logOutput) {
        console.log('[STDOUT]', data);
      }
      outputs.push(data);
    });

    // Capture stderr
    runner.on('stderr', (data) => {
      if (logOutput) {
        console.error('[STDERR]', data);
      }
      errors.push(data);
    });

    // Track build events
    if (trackEvents.includes('build:start')) {
      runner.on('build:start', () => {
        events.push('build:start');
        if (logOutput) console.log('✓ Event: build:start');
      });
    }

    if (trackEvents.includes('build:progress')) {
      runner.on('build:progress', (data) => {
        events.push(`build:progress:${data?.progress || 'unknown'}`);
        if (logOutput) console.log('ℹ Event: build:progress', data);
      });
    }

    if (trackEvents.includes('build:complete')) {
      runner.on('build:complete', () => {
        buildComplete = true;
        events.push('build:complete');
        if (logOutput) console.log('✓ Event: build:complete');

        if (successCondition === 'build:complete') {
          resolve(createResult(true));
        }
      });
    }

    if (trackEvents.includes('build:failed')) {
      runner.on('build:failed', () => {
        events.push('build:failed');
        if (logOutput) console.log('✗ Event: build:failed');
        resolve(createResult(false));
      });
    }

    if (trackEvents.includes('failed')) {
      runner.on('failed', (code, sig) => {
        exitCode = code ?? undefined;
        signal = sig;
        events.push(`failed:${code}`);
        if (logOutput) console.log(`✗ Event: failed (code: ${code})`);
        resolve(createResult(false));
      });
    }

    if (trackEvents.includes('exit')) {
      runner.on('exit', (code, sig) => {
        exitCode = code ?? undefined;
        signal = sig;
        events.push(`exit:${code}`);
        if (logOutput) console.log(`ℹ Event: exit (code: ${code})`);

        if (successCondition === 'exit:0' && code === 0) {
          resolve(createResult(true));
        } else if (successCondition === 'build:complete' && !buildComplete) {
          // If waiting for build:complete but got exit, that's a failure
          resolve(createResult(false));
        }
      });
    }

    if (trackEvents.includes('status')) {
      runner.on('status', (status) => {
        events.push(`status:${status}`);
        if (logOutput) console.log(`ℹ Status: ${status}`);
      });
    }

    // Timeout handler
    const timeoutId = setTimeout(() => {
      if (logOutput) console.log('⏱ Timeout reached');
      resolve(createResult(false));
    }, timeout);

    // Helper to create result object
    function createResult(success: boolean): RunnerTestResult {
      clearTimeout(timeoutId);

      const result: RunnerTestResult = {
        success: customSuccessCheck
          ? customSuccessCheck({ success, outputs, errors, buildComplete, exitCode, signal, events })
          : success,
        outputs,
        errors,
        buildComplete,
        exitCode,
        signal,
        events,
      };

      return result;
    }

    // Start the runner
    runner.start().then(() => {
      if (expectedStatus && logOutput) {
        const matches = expectedStatus.test(runner.status);
        console.log(`ℹ Status after start: ${runner.status} (expected: ${expectedStatus}) - ${matches ? '✓' : '✗'}`);
      }
    }).catch((error) => {
      if (logOutput) {
        console.error('✗ Runner start failed:', error);
      }
      resolve(createResult(false));
    });
  });
}

/**
 * Wait for a specific event on a runner
 *
 * @param runner - The process runner
 * @param eventName - Name of the event to wait for
 * @param timeout - Timeout in milliseconds (default: 30000)
 * @returns Promise that resolves when event fires or rejects on timeout
 */
export async function waitForEvent(
  runner: ProcessRunner,
  eventName: string,
  timeout = 30000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);

    runner.once(eventName, (data) => {
      clearTimeout(timeoutId);
      resolve(data);
    });
  });
}

/**
 * Capture all output from a runner for a specific duration
 *
 * @param runner - The process runner
 * @param duration - Duration in milliseconds
 * @returns Promise with captured output
 */
export async function captureOutput(
  runner: ProcessRunner,
  duration: number
): Promise<{ stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const stdoutHandler = (data: string) => stdout.push(data);
  const stderrHandler = (data: string) => stderr.push(data);

  runner.on('stdout', stdoutHandler);
  runner.on('stderr', stderrHandler);

  await new Promise(resolve => setTimeout(resolve, duration));

  runner.off('stdout', stdoutHandler);
  runner.off('stderr', stderrHandler);

  return { stdout, stderr };
}
