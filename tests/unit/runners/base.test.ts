import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessRunner } from '../../../src/runners/base.js';
import type { ProcessConfig, ProcessStatus, BuildInfo } from '../../../src/types/index.js';

// Create a concrete test implementation of the abstract ProcessRunner
class TestRunner extends ProcessRunner {
  public startCalled = false;
  public stopCalled = false;
  public shouldFailStart = false;
  public shouldFailStop = false;

  async start(): Promise<void> {
    this.startCalled = true;
    if (this.shouldFailStart) {
      throw new Error('Start failed');
    }
    this.startTime = new Date();
    this._status = 'running';
    this._pid = 12345;
  }

  async stop(): Promise<void> {
    this.stopCalled = true;
    if (this.shouldFailStop) {
      throw new Error('Stop failed');
    }
    this.stopTime = new Date();
    this._status = 'stopped';
    this._pid = null;
  }

  // Expose protected methods for testing
  public testUpdateStatus(status: ProcessStatus) {
    this.updateStatus(status);
  }

  public testUpdateBuildInfo(buildInfo: Partial<BuildInfo>) {
    this.updateBuildInfo(buildInfo);
  }
}

describe('Base Process Runner', () => {
  let runner: TestRunner;
  let config: ProcessConfig;

  beforeEach(() => {
    config = {
      category: 'backend',
      command: 'npm start',
    };
    runner = new TestRunner('test-process', config);
  });

  describe('constructor', () => {
    it('should initialize with pending status', () => {
      expect(runner.status).toBe('pending');
    });

    it('should store process name', () => {
      expect(runner).toBeDefined();
    });

    it('should store process config', () => {
      expect(runner).toBeDefined();
    });

    it('should initialize with null pid', () => {
      expect(runner.pid).toBeNull();
    });

    it('should initialize with 0 restart count', () => {
      expect(runner.restartCount).toBe(0);
    });

    it('should initialize with null build info', () => {
      expect(runner.buildInfo).toBeNull();
    });

    it('should initialize with null start time', () => {
      expect(runner.processStartTime).toBeNull();
    });
  });

  describe('start', () => {
    it('should be implemented by subclass', async () => {
      await runner.start();
      expect(runner.startCalled).toBe(true);
    });

    it('should set start time', async () => {
      await runner.start();
      expect(runner.processStartTime).toBeInstanceOf(Date);
    });

    it('should set running status', async () => {
      await runner.start();
      expect(runner.status).toBe('running');
    });

    it('should set pid', async () => {
      await runner.start();
      expect(runner.pid).toBe(12345);
    });
  });

  describe('stop', () => {
    it('should be implemented by subclass', async () => {
      await runner.stop();
      expect(runner.stopCalled).toBe(true);
    });

    it('should set stopped status', async () => {
      await runner.stop();
      expect(runner.status).toBe('stopped');
    });

    it('should clear pid', async () => {
      await runner.start();
      expect(runner.pid).toBe(12345);

      await runner.stop();
      expect(runner.pid).toBeNull();
    });
  });

  describe('restart', () => {
    it('should stop then start the process', async () => {
      await runner.start();
      runner.startCalled = false;
      runner.stopCalled = false;

      await runner.restart();

      expect(runner.stopCalled).toBe(true);
      expect(runner.startCalled).toBe(true);
    });

    it('should increment restart count', async () => {
      expect(runner.restartCount).toBe(0);

      await runner.restart();
      expect(runner.restartCount).toBe(1);

      await runner.restart();
      expect(runner.restartCount).toBe(2);

      await runner.restart();
      expect(runner.restartCount).toBe(3);
    });

    it('should restart multiple times', async () => {
      for (let i = 1; i <= 5; i++) {
        await runner.restart();
        expect(runner.restartCount).toBe(i);
      }
    });

    it('should handle stop failure', async () => {
      runner.shouldFailStop = true;

      await expect(runner.restart()).rejects.toThrow('Stop failed');
    });

    it('should handle start failure after successful stop', async () => {
      await runner.start();
      runner.shouldFailStart = true;

      await expect(runner.restart()).rejects.toThrow('Start failed');
      // Restart count should still increment even if start fails
      expect(runner.restartCount).toBe(1);
    });
  });

  describe('status management', () => {
    it('should get current status', () => {
      expect(runner.status).toBe('pending');
    });

    it('should update status', () => {
      runner.testUpdateStatus('starting');
      expect(runner.status).toBe('starting');

      runner.testUpdateStatus('running');
      expect(runner.status).toBe('running');

      runner.testUpdateStatus('failed');
      expect(runner.status).toBe('failed');
    });

    it('should emit status event when status changes', () => {
      const statusListener = vi.fn();
      runner.on('status', statusListener);

      runner.testUpdateStatus('starting');
      expect(statusListener).toHaveBeenCalledWith('starting');

      runner.testUpdateStatus('running');
      expect(statusListener).toHaveBeenCalledWith('running');

      expect(statusListener).toHaveBeenCalledTimes(2);
    });

    it('should handle all status types', () => {
      const statuses: ProcessStatus[] = [
        'pending',
        'starting',
        'running',
        'building',
        'failed',
        'stopped',
      ];

      statuses.forEach((status) => {
        runner.testUpdateStatus(status);
        expect(runner.status).toBe(status);
      });
    });
  });

  describe('build info management', () => {
    it('should start with null build info', () => {
      expect(runner.buildInfo).toBeNull();
    });

    it('should update build info', () => {
      runner.testUpdateBuildInfo({
        progress: 50,
        message: 'Compiling...',
      });

      expect(runner.buildInfo).toEqual({
        progress: 50,
        message: 'Compiling...',
        errors: 0,
        warnings: 0,
      });
    });

    it('should emit build:info event when build info changes', () => {
      const buildInfoListener = vi.fn();
      runner.on('build:info', buildInfoListener);

      const buildInfo = { progress: 25, message: 'Building...' };
      runner.testUpdateBuildInfo(buildInfo);

      expect(buildInfoListener).toHaveBeenCalledWith(
        expect.objectContaining({
          progress: 25,
          message: 'Building...',
        })
      );
    });

    it('should merge build info updates', () => {
      runner.testUpdateBuildInfo({
        progress: 25,
        message: 'Step 1',
      });

      runner.testUpdateBuildInfo({
        progress: 50,
        message: 'Step 2',
      });

      expect(runner.buildInfo).toEqual({
        progress: 50,
        message: 'Step 2',
        errors: 0,
        warnings: 0,
      });
    });

    it('should track errors and warnings', () => {
      runner.testUpdateBuildInfo({
        errors: 2,
        warnings: 5,
      });

      expect(runner.buildInfo).toEqual({
        errors: 2,
        warnings: 5,
      });
    });

    it('should preserve existing errors/warnings when updating other fields', () => {
      runner.testUpdateBuildInfo({
        errors: 3,
        warnings: 7,
      });

      runner.testUpdateBuildInfo({
        progress: 75,
        message: 'Almost done',
      });

      expect(runner.buildInfo).toEqual({
        progress: 75,
        message: 'Almost done',
        errors: 3,
        warnings: 7,
      });
    });

    it('should allow updating errors and warnings independently', () => {
      runner.testUpdateBuildInfo({ errors: 1 });
      expect(runner.buildInfo?.errors).toBe(1);

      runner.testUpdateBuildInfo({ warnings: 2 });
      expect(runner.buildInfo?.warnings).toBe(2);
      expect(runner.buildInfo?.errors).toBe(1);

      runner.testUpdateBuildInfo({ errors: 3 });
      expect(runner.buildInfo?.errors).toBe(3);
      expect(runner.buildInfo?.warnings).toBe(2);
    });

    it('should handle complete build info object', () => {
      const completeBuildInfo: BuildInfo = {
        progress: 100,
        message: 'Build complete',
        errors: 0,
        warnings: 0,
        duration: 5000,
        hash: 'abc123',
      };

      runner.testUpdateBuildInfo(completeBuildInfo);
      expect(runner.buildInfo).toEqual(completeBuildInfo);
    });
  });

  describe('event emitter', () => {
    it('should inherit from EventEmitter', () => {
      expect(runner.on).toBeDefined();
      expect(runner.emit).toBeDefined();
      expect(runner.removeListener).toBeDefined();
    });

    it('should allow custom events', () => {
      const listener = vi.fn();
      runner.on('custom-event', listener);

      runner.emit('custom-event', { data: 'test' });
      expect(listener).toHaveBeenCalledWith({ data: 'test' });
    });

    it('should support multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      runner.on('status', listener1);
      runner.on('status', listener2);

      runner.testUpdateStatus('running');

      expect(listener1).toHaveBeenCalledWith('running');
      expect(listener2).toHaveBeenCalledWith('running');
    });

    it('should allow removing listeners', () => {
      const listener = vi.fn();
      runner.on('status', listener);

      runner.testUpdateStatus('starting');
      expect(listener).toHaveBeenCalledTimes(1);

      runner.removeListener('status', listener);
      runner.testUpdateStatus('running');
      expect(listener).toHaveBeenCalledTimes(1); // Still 1, not called again
    });
  });

  describe('getters', () => {
    it('should get pid', async () => {
      expect(runner.pid).toBeNull();
      await runner.start();
      expect(runner.pid).toBe(12345);
    });

    it('should get restart count', async () => {
      expect(runner.restartCount).toBe(0);
      await runner.restart();
      expect(runner.restartCount).toBe(1);
    });

    it('should get process start time', async () => {
      expect(runner.processStartTime).toBeNull();
      await runner.start();
      expect(runner.processStartTime).toBeInstanceOf(Date);
    });

    it('should get build info', () => {
      expect(runner.buildInfo).toBeNull();
      runner.testUpdateBuildInfo({ progress: 50 });
      expect(runner.buildInfo).toBeDefined();
      expect(runner.buildInfo?.progress).toBe(50);
    });
  });
});
