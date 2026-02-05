/**
 * BashRunner Integration Tests
 *
 * Tests the BashRunner with real bash commands
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BashRunner } from '../../../src/runners/bash.js';
import type { ProcessConfig } from '../../../src/types/index.js';
import { runProcess } from './runner-test-helper.js';

describe('BashRunner Integration', () => {
  let runner: BashRunner;

  afterEach(async () => {
    if (runner) {
      await runner.stop();
    }
  });

  describe('basic command execution', () => {
    it('should execute a simple echo command', async () => {
      const config: ProcessConfig = {
        category: 'test',
        command: 'echo "Hello from bash"; sleep 0.5',
      };

      runner = new BashRunner('echo-test', config);

      const result = await runProcess(runner, {
        timeout: 1000,
        expectedStatus: /running/,
        successCondition: 'exit:0',
      });

      expect(result.success).toBe(true);
      expect(result.outputs.join('')).toContain('Hello from bash');
    });

    it('should execute a multi-line script', async () => {
      const config: ProcessConfig = {
        category: 'test',
        command: `
          echo "Line 1"
          echo "Line 2"
          echo "Line 3"
          sleep 0.5
        `,
      };

      runner = new BashRunner('multiline-test', config);

      const result = await runProcess(runner, {
        timeout: 1000,
        successCondition: 'exit:0',
      });

      expect(result.success).toBe(true);
      const output = result.outputs.join('');
      expect(output).toContain('Line 1');
      expect(output).toContain('Line 2');
      expect(output).toContain('Line 3');
    });

    it('should handle environment variables', async () => {
      const config: ProcessConfig = {
        category: 'test',
        command: 'echo "TEST_VAR=$TEST_VAR"',
        env: {
          TEST_VAR: 'test-value-123',
        },
      };

      runner = new BashRunner('env-test', config);

      const result = await runProcess(runner, {
        timeout: 500,
        successCondition: 'exit:0',
      });

      expect(result.success).toBe(true);
      expect(result.outputs.join('')).toContain('TEST_VAR=test-value-123');
    });

    it('should respect working directory', async () => {
      const config: ProcessConfig = {
        category: 'test',
        command: 'pwd',
        cwd: '/tmp',
      };

      runner = new BashRunner('cwd-test', config);

      const result = await runProcess(runner, {
        timeout: 500,
        successCondition: 'exit:0',
      });

      expect(result.success).toBe(true);
      expect(result.outputs.join('')).toContain('/tmp');
    });
  });

  describe('long-running processes', () => {
    it('should run a long-running process and stop it', async () => {
      const config: ProcessConfig = {
        category: 'test',
        command: 'while true; do echo "tick"; sleep 0.5; done',
      };

      runner = new BashRunner('loop-test', config);

      const outputs: string[] = [];
      runner.on('stdout', (data) => outputs.push(data));

      await runner.start();

      expect(runner.status).toBe('running');
      expect(runner.pid).toBeGreaterThan(0);

      // Wait for some output
      await new Promise(resolve => setTimeout(resolve, 1500));

      expect(outputs.length).toBeGreaterThan(0);
      expect(outputs.join('')).toContain('tick');

      // Stop the process
      await runner.stop();

      expect(runner.status).toBe('stopped');
      expect(runner.pid).toBe(null);
    });
  });

  describe('error handling', () => {
    it('should capture stderr output', async () => {
      const config: ProcessConfig = {
        category: 'test',
        command: 'echo "error message" >&2',
      };

      runner = new BashRunner('stderr-test', config);

      const result = await runProcess(runner, {
        timeout: 500,
        successCondition: 'exit:0',
      });

      expect(result.success).toBe(true);
      expect(result.errors.join('')).toContain('error message');
    });

    it('should handle command that exits with non-zero code', async () => {
      const config: ProcessConfig = {
        category: 'test',
        command: 'exit 1',
      };

      runner = new BashRunner('exit-code-test', config);

      const result = await runProcess(runner, {
        timeout: 500,
        trackEvents: ['failed', 'exit'],
        successCondition: 'custom',
        customSuccessCheck: (res) => {
          // Success means we caught the failure event
          return res.events.includes('failed:1') && res.exitCode === 1;
        },
      });

      expect(result.success).toBe(true);
      expect(runner.status).toBe('failed');
    });
  });

  describe('exit-code ready check', () => {
    it('should wait for successful exit with exit-code ready check', async () => {
      const config: ProcessConfig = {
        category: 'test',
        command: 'echo "Processing..."; sleep 0.2; exit 0',
        ready: {
          type: 'exit-code',
        },
      };

      runner = new BashRunner('exit-code-ready-test', config);

      const result = await runProcess(runner, {
        timeout: 1000,
        expectedStatus: /running/,
        successCondition: 'exit:0',
      });

      expect(result.success).toBe(true);
      expect(result.outputs.join('')).toContain('Processing');
    });

    it('should fail if exit-code ready check gets non-zero exit', async () => {
      const config: ProcessConfig = {
        category: 'test',
        command: 'echo "Failed"; exit 1',
        ready: {
          type: 'exit-code',
        },
      };

      runner = new BashRunner('exit-code-fail-test', config);

      await expect(runner.start()).rejects.toThrow('Process exited with code 1');
      expect(runner.status).toBe('failed');
    });
  });

  describe('restart functionality', () => {
    it('should restart a process', async () => {
      const config: ProcessConfig = {
        category: 'test',
        command: 'echo "Started"; sleep 0.5',
      };

      runner = new BashRunner('restart-test', config);

      // First run
      const firstResult = await runProcess(runner, {
        timeout: 1000,
        successCondition: 'exit:0',
      });

      expect(firstResult.success).toBe(true);
      expect(runner.restartCount).toBe(0);

      const firstPid = runner.pid;

      // Restart
      await runner.restart();

      expect(runner.restartCount).toBe(1);
      if (firstPid) {
        expect(runner.pid).not.toBe(firstPid);
      }
    });
  });
});
