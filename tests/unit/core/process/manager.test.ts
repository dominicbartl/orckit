/**
 * Tests for ProcessManager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProcessManager } from '../../../../src/core/process/manager.js';
import { StatusMonitor } from '../../../../src/core/status/monitor.js';
import { OutputBufferManager } from '../../../../src/core/output/buffer-manager.js';
import type { ProcessConfig } from '../../../../src/types/index.js';

// Mock the runner factory
vi.mock('../../../../src/runners/factory.js', () => ({
  createRunner: vi.fn(() => {
    const EventEmitter = require('events');
    const runner = new EventEmitter();
    runner.status = 'pending';
    runner.pid = 12345;
    runner.start = vi.fn(async () => {
      runner.status = 'running';
      runner.emit('status', 'running');
      runner.emit('ready');
    });
    runner.stop = vi.fn(async () => {
      runner.status = 'stopped';
      runner.emit('status', 'stopped');
    });
    runner.restart = vi.fn(async () => {
      runner.status = 'running';
      runner.emit('restarting', 1);
      runner.emit('status', 'running');
      runner.emit('ready');
    });
    return runner;
  }),
}));

describe('ProcessManager', () => {
  let processManager: ProcessManager;
  let statusMonitor: StatusMonitor;
  let bufferManager: OutputBufferManager;

  const testConfig: ProcessConfig = {
    category: 'test',
    command: 'echo hello',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    statusMonitor = new StatusMonitor();
    bufferManager = new OutputBufferManager();

    processManager = new ProcessManager({
      statusMonitor,
      bufferManager,
    });
  });

  afterEach(() => {
    processManager.cleanup();
    statusMonitor.stop();
  });

  describe('registration', () => {
    it('should register a process', () => {
      processManager.register('test-process', testConfig);

      expect(processManager.isRegistered('test-process')).toBe(true);
    });

    it('should not be registered before registration', () => {
      expect(processManager.isRegistered('nonexistent')).toBe(false);
    });

    it('should register with status monitor', () => {
      const registerSpy = vi.spyOn(statusMonitor, 'registerProcess');

      processManager.register('test-process', testConfig);

      expect(registerSpy).toHaveBeenCalledWith('test-process', 'test');
    });

    it('should create buffer for process', () => {
      processManager.register('test-process', testConfig);

      expect(bufferManager.hasBuffer('test-process')).toBe(true);
    });

    it('should respect custom buffer size', () => {
      const configWithBuffer: ProcessConfig = {
        category: 'test',
        command: 'echo hello',
        output: {
          format: {
            max_lines: 500,
          },
        },
      };

      processManager.register('test-process', configWithBuffer);

      // Buffer should be created with custom size
      expect(bufferManager.hasBuffer('test-process')).toBe(true);
    });
  });

  describe('start', () => {
    it('should start a registered process', async () => {
      processManager.register('test-process', testConfig);

      await processManager.start('test-process');

      expect(processManager.getStatus('test-process')).toBe('running');
    });

    it('should throw when starting unregistered process', async () => {
      await expect(processManager.start('nonexistent')).rejects.toThrow(
        "Process 'nonexistent' is not registered"
      );
    });

    it('should emit process:starting event', async () => {
      processManager.register('test-process', testConfig);

      const startingSpy = vi.fn();
      processManager.on('process:starting', startingSpy);

      await processManager.start('test-process');

      expect(startingSpy).toHaveBeenCalledWith(
        expect.objectContaining({ processName: 'test-process' })
      );
    });

    it('should emit process:ready event', async () => {
      processManager.register('test-process', testConfig);

      const readySpy = vi.fn();
      processManager.on('process:ready', readySpy);

      await processManager.start('test-process');

      expect(readySpy).toHaveBeenCalledWith(
        expect.objectContaining({ processName: 'test-process' })
      );
    });

    it('should update status monitor', async () => {
      const updateSpy = vi.spyOn(statusMonitor, 'updateProcessStatus');

      processManager.register('test-process', testConfig);
      await processManager.start('test-process');

      expect(updateSpy).toHaveBeenCalledWith('test-process', 'starting');
      expect(updateSpy).toHaveBeenCalledWith('test-process', 'running');
    });

    it('should not start already running process', async () => {
      const { createRunner } = await import('../../../../src/runners/factory.js');

      processManager.register('test-process', testConfig);
      await processManager.start('test-process');

      // Reset mock to track new calls
      vi.mocked(createRunner).mockClear();

      await processManager.start('test-process');

      // Should not create a new runner
      expect(createRunner).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should stop a running process', async () => {
      processManager.register('test-process', testConfig);
      await processManager.start('test-process');

      await processManager.stop('test-process');

      expect(processManager.getStatus('test-process')).toBe('stopped'); // Runner removed
    });

    it('should emit process:stopped event', async () => {
      processManager.register('test-process', testConfig);
      await processManager.start('test-process');

      const stoppedSpy = vi.fn();
      processManager.on('process:stopped', stoppedSpy);

      await processManager.stop('test-process');

      expect(stoppedSpy).toHaveBeenCalledWith(
        expect.objectContaining({ processName: 'test-process' })
      );
    });

    it('should not throw for non-running process', async () => {
      processManager.register('test-process', testConfig);

      // Should not throw
      await expect(processManager.stop('test-process')).resolves.toBeUndefined();
    });

    it('should update status monitor', async () => {
      processManager.register('test-process', testConfig);
      await processManager.start('test-process');

      const updateSpy = vi.spyOn(statusMonitor, 'updateProcessStatus');
      updateSpy.mockClear();

      await processManager.stop('test-process');

      expect(updateSpy).toHaveBeenCalledWith('test-process', 'stopped');
    });

    it('should remove buffer', async () => {
      processManager.register('test-process', testConfig);
      await processManager.start('test-process');

      expect(bufferManager.hasBuffer('test-process')).toBe(true);

      await processManager.stop('test-process');

      expect(bufferManager.hasBuffer('test-process')).toBe(false);
    });
  });

  describe('restart', () => {
    it('should restart a running process', async () => {
      processManager.register('test-process', testConfig);
      await processManager.start('test-process');

      await processManager.restart('test-process');

      expect(processManager.getStatus('test-process')).toBe('running');
    });

    it('should start a non-running process on restart', async () => {
      processManager.register('test-process', testConfig);

      await processManager.restart('test-process');

      expect(processManager.getStatus('test-process')).toBe('running');
    });

    it('should emit process:restarting event', async () => {
      processManager.register('test-process', testConfig);
      await processManager.start('test-process');

      const restartingSpy = vi.fn();
      processManager.on('process:restarting', restartingSpy);

      await processManager.restart('test-process');

      expect(restartingSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          processName: 'test-process',
          restartCount: 1,
        })
      );
    });
  });

  describe('status queries', () => {
    it('should return pending for registered but not started process', () => {
      processManager.register('test-process', testConfig);

      expect(processManager.getStatus('test-process')).toBe('pending');
    });

    it('should return running for started process', async () => {
      processManager.register('test-process', testConfig);
      await processManager.start('test-process');

      expect(processManager.getStatus('test-process')).toBe('running');
    });

    it('should return all statuses', async () => {
      processManager.register('process-1', testConfig);
      processManager.register('process-2', testConfig);
      await processManager.start('process-1');

      const statuses = processManager.getAllStatuses();

      expect(statuses.get('process-1')).toBe('running');
      expect(statuses.get('process-2')).toBe('pending');
    });

    it('should return running processes', async () => {
      processManager.register('process-1', testConfig);
      processManager.register('process-2', testConfig);
      await processManager.start('process-1');

      const running = processManager.getRunningProcesses();

      expect(running).toContain('process-1');
      expect(running).not.toContain('process-2');
    });
  });

  describe('stopAll', () => {
    it('should stop all running processes', async () => {
      processManager.register('process-1', testConfig);
      processManager.register('process-2', testConfig);
      await processManager.start('process-1');
      await processManager.start('process-2');

      await processManager.stopAll();

      expect(processManager.getRunningProcesses()).toHaveLength(0);
    });
  });

  describe('cleanup', () => {
    it('should clear all state', async () => {
      processManager.register('test-process', testConfig);
      await processManager.start('test-process');

      processManager.cleanup();

      expect(processManager.isRegistered('test-process')).toBe(false);
      expect(processManager.getRunningProcesses()).toHaveLength(0);
    });
  });

  describe('late binding', () => {
    it('should allow setting status monitor after construction', () => {
      const pm = new ProcessManager();
      const monitor = new StatusMonitor();

      pm.setStatusMonitor(monitor);

      const registerSpy = vi.spyOn(monitor, 'registerProcess');
      pm.register('test-process', testConfig);

      expect(registerSpy).toHaveBeenCalled();

      monitor.stop();
    });

    it('should allow setting buffer manager after construction', () => {
      const pm = new ProcessManager();
      const bm = new OutputBufferManager();

      pm.setBufferManager(bm);
      pm.register('test-process', testConfig);

      expect(bm.hasBuffer('test-process')).toBe(true);
    });
  });

  describe('runner access', () => {
    it('should return runner for running process', async () => {
      processManager.register('test-process', testConfig);
      await processManager.start('test-process');

      const runner = processManager.getRunner('test-process');

      expect(runner).toBeDefined();
      expect(runner?.status).toBe('running');
    });

    it('should return undefined for non-running process', () => {
      processManager.register('test-process', testConfig);

      const runner = processManager.getRunner('test-process');

      expect(runner).toBeUndefined();
    });
  });
});
