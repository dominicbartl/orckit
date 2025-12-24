/**
 * Orckit Integration Tests
 *
 * Tests real process orchestration with different configurations.
 * These tests spawn actual processes and verify their behavior.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Orckit } from '@/core/orckit';
import type { OrckitConfig, ProcessConfig, OutputLine } from '@/types';

describe('Orckit Integration', () => {
  let orckit: Orckit | null = null;

  afterEach(async () => {
    if (orckit) {
      try {
        await orckit.stop();
      } catch {
        // Ignore cleanup errors
      }
      orckit = null;
    }
  });

  describe('single process', () => {
    it('should start and run a simple echo command', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-echo',
        processes: {
          echo: {
            category: 'test',
            type: 'bash',
            command: 'echo "Hello from Orckit"',
            ready: { type: 'exit-code' },
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const events: string[] = [];
      orckit.on('process:starting', (e) => events.push(`starting:${e.processName}`));
      orckit.on('process:ready', (e) => events.push(`ready:${e.processName}`));
      orckit.on('all:ready', () => events.push('all:ready'));

      await orckit.start();

      expect(events).toContain('starting:echo');
      expect(orckit.getStatus('echo')).toBe('running');
    });

    it('should capture process output in buffer', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-output',
        processes: {
          printer: {
            category: 'test',
            type: 'bash',
            command: 'echo "Line 1" && echo "Line 2" && echo "Line 3"',
            ready: { type: 'exit-code' },
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      await orckit.start();

      // Wait for output to be captured
      await new Promise((resolve) => setTimeout(resolve, 500));

      const buffer = orckit.getBufferManager().getBuffer('printer');
      const lines = buffer.map((l: OutputLine) => l.content);

      expect(lines.some((l: string) => l.includes('Line 1'))).toBe(true);
      expect(lines.some((l: string) => l.includes('Line 2'))).toBe(true);
      expect(lines.some((l: string) => l.includes('Line 3'))).toBe(true);
    });

    it('should handle a long-running process', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-longrun',
        processes: {
          ticker: {
            category: 'test',
            type: 'bash',
            command: 'for i in 1 2 3; do echo "Tick $i"; sleep 0.1; done',
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      await orckit.start();

      // Process should be running
      expect(['starting', 'running']).toContain(orckit.getStatus('ticker'));

      // Wait for some output
      await new Promise((resolve) => setTimeout(resolve, 500));

      const buffer = orckit.getBufferManager().getBuffer('ticker');
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('should stop a running process', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-stop',
        processes: {
          sleeper: {
            category: 'test',
            type: 'bash',
            command: 'sleep 30',
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      await orckit.start();
      expect(['starting', 'running']).toContain(orckit.getStatus('sleeper'));

      await orckit.stop();
      expect(orckit.getStatus('sleeper')).toBe('stopped');
    });
  });

  describe('multiple processes', () => {
    it('should start multiple processes in parallel', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-parallel',
        processes: {
          proc1: {
            category: 'group-a',
            type: 'bash',
            command: 'echo "Process 1 started" && sleep 0.2',
          },
          proc2: {
            category: 'group-b',
            type: 'bash',
            command: 'echo "Process 2 started" && sleep 0.2',
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const startTimes: Record<string, number> = {};
      orckit.on('process:starting', (e) => {
        startTimes[e.processName] = Date.now();
      });

      await orckit.start();

      // Both should have started
      expect(Object.keys(startTimes)).toContain('proc1');
      expect(Object.keys(startTimes)).toContain('proc2');

      // They should have started at roughly the same time (parallel)
      const timeDiff = Math.abs(startTimes['proc1'] - startTimes['proc2']);
      expect(timeDiff).toBeLessThan(500); // Within 500ms of each other
    });

    it('should respect process dependencies', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-deps',
        processes: {
          database: {
            category: 'infra',
            type: 'bash',
            command: 'echo "DB started" && sleep 0.1',
          },
          api: {
            category: 'backend',
            type: 'bash',
            command: 'echo "API started"',
            dependencies: ['database'],
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const startOrder: string[] = [];
      orckit.on('process:starting', (e) => {
        startOrder.push(e.processName);
      });

      await orckit.start();

      // Database should start before API
      expect(startOrder.indexOf('database')).toBeLessThan(startOrder.indexOf('api'));
    });

    it('should stop all processes', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-stopall',
        processes: {
          proc1: {
            category: 'test',
            type: 'bash',
            command: 'sleep 30',
          },
          proc2: {
            category: 'test',
            type: 'bash',
            command: 'sleep 30',
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      await orckit.start();

      await orckit.stop();

      expect(orckit.getStatus('proc1')).toBe('stopped');
      expect(orckit.getStatus('proc2')).toBe('stopped');
    });
  });

  describe('process restart', () => {
    it('should restart a specific process', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-restart',
        processes: {
          worker: {
            category: 'test',
            type: 'bash',
            command: 'echo "Worker running" && sleep 10',
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      await orckit.start();

      const restartEvents: string[] = [];
      orckit.on('process:restarting', (e) => restartEvents.push(e.processName));

      await orckit.restart(['worker']);

      expect(restartEvents).toContain('worker');
      expect(['starting', 'running']).toContain(orckit.getStatus('worker'));
    });
  });

  describe('environment variables', () => {
    it('should pass environment variables to processes', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-env',
        processes: {
          envtest: {
            category: 'test',
            type: 'bash',
            command: 'echo "MY_VAR=$MY_VAR"',
            env: {
              MY_VAR: 'hello-world',
            },
            ready: { type: 'exit-code' },
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      await orckit.start();
      await new Promise((resolve) => setTimeout(resolve, 300));

      const buffer = orckit.getBufferManager().getBuffer('envtest');
      const output = buffer.map((l: OutputLine) => l.content).join('\n');

      expect(output).toContain('MY_VAR=hello-world');
    });
  });

  describe('error handling', () => {
    it('should handle process that exits with error', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-error',
        processes: {
          failer: {
            category: 'test',
            type: 'bash',
            command: 'echo "About to fail" && exit 1',
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const failedEvents: string[] = [];
      orckit.on('process:failed', (e) => failedEvents.push(e.processName));

      await orckit.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(failedEvents).toContain('failer');
    });

    it('should handle non-existent command', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-notfound',
        processes: {
          notfound: {
            category: 'test',
            type: 'bash',
            command: 'this-command-does-not-exist-12345',
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const failedEvents: string[] = [];
      orckit.on('process:failed', (e) => failedEvents.push(e.processName));

      await orckit.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(failedEvents).toContain('notfound');
    });
  });

  describe('selective start', () => {
    it('should start only specified processes', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-selective',
        processes: {
          proc1: {
            category: 'test',
            type: 'bash',
            command: 'echo "Proc 1"',
          },
          proc2: {
            category: 'test',
            type: 'bash',
            command: 'echo "Proc 2"',
          },
          proc3: {
            category: 'test',
            type: 'bash',
            command: 'echo "Proc 3"',
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const startedProcesses: string[] = [];
      orckit.on('process:starting', (e) => startedProcesses.push(e.processName));

      await orckit.start(['proc1', 'proc3']);

      expect(startedProcesses).toContain('proc1');
      expect(startedProcesses).not.toContain('proc2');
      expect(startedProcesses).toContain('proc3');
    });

    it('should start dependencies of specified processes', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-selectivedeps',
        processes: {
          base: {
            category: 'infra',
            type: 'bash',
            command: 'echo "Base"',
          },
          dependent: {
            category: 'app',
            type: 'bash',
            command: 'echo "Dependent"',
            dependencies: ['base'],
          },
          independent: {
            category: 'other',
            type: 'bash',
            command: 'echo "Independent"',
          },
        },
      };

      orckit = new Orckit({
        config,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const startedProcesses: string[] = [];
      orckit.on('process:starting', (e) => startedProcesses.push(e.processName));

      // Start only 'dependent', but 'base' should also start
      await orckit.start(['dependent']);

      expect(startedProcesses).toContain('base');
      expect(startedProcesses).toContain('dependent');
      expect(startedProcesses).not.toContain('independent');
    });
  });
});
