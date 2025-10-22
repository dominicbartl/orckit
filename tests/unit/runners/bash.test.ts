import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { BashRunner } from '../../../src/runners/bash.js';
import type { ProcessConfig } from '../../../src/types/index.js';

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock system utils
vi.mock('../../../src/utils/system.js', () => ({
  getProcessEnv: vi.fn((env) => ({ ...process.env, ...env })),
}));

describe('Bash Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('start', () => {
    it('should start a bash process', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
      };

      const runner = new BashRunner('api', config);
      const startPromise = runner.start();

      // Wait a bit for async setup
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(runner.status).toBe('running');
      expect(runner.pid).toBe(12345);
      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'npm start'],
        expect.objectContaining({
          cwd: process.cwd(),
          reject: false,
          all: true,
        })
      );
    });

    it('should use custom working directory', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
        cwd: '/custom/path',
      };

      const runner = new BashRunner('api', config);
      await runner.start();

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'npm start'],
        expect.objectContaining({
          cwd: '/custom/path',
        })
      );
    });

    it('should pass environment variables', async () => {
      const { execa } = await import('execa');
      const { getProcessEnv } = await import('../../../src/utils/system.js');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
        env: {
          NODE_ENV: 'production',
          PORT: '3000',
        },
      };

      const runner = new BashRunner('api', config);
      await runner.start();

      expect(getProcessEnv).toHaveBeenCalledWith({
        NODE_ENV: 'production',
        PORT: '3000',
      });
    });

    it('should set status to starting then running', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
      };

      const runner = new BashRunner('api', config);
      const statusChanges: string[] = [];

      runner.on('status', (status) => statusChanges.push(status));

      await runner.start();

      expect(statusChanges).toContain('starting');
      expect(statusChanges).toContain('running');
      expect(runner.status).toBe('running');
    });

    it('should emit stdout events', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
      };

      const runner = new BashRunner('api', config);
      const stdoutListener = vi.fn();
      runner.on('stdout', stdoutListener);

      await runner.start();

      // Simulate stdout data
      mockProcess.stdout.emit('data', Buffer.from('Server started\n'));

      expect(stdoutListener).toHaveBeenCalledWith('Server started\n');
    });

    it('should emit stderr events', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
      };

      const runner = new BashRunner('api', config);
      const stderrListener = vi.fn();
      runner.on('stderr', stderrListener);

      await runner.start();

      // Simulate stderr data
      mockProcess.stderr.emit('data', Buffer.from('Warning: deprecated\n'));

      expect(stderrListener).toHaveBeenCalledWith('Warning: deprecated\n');
    });

    it('should handle process exit with code 0', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
      };

      const runner = new BashRunner('api', config);
      const exitListener = vi.fn();
      runner.on('exit', exitListener);

      await runner.start();

      // Simulate process exit
      mockProcess.emit('exit', 0, null);

      expect(exitListener).toHaveBeenCalledWith(0, null);
      expect(runner.status).toBe('stopped');
      expect(runner.pid).toBeNull();
    });

    it('should handle process exit with non-zero code', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
      };

      const runner = new BashRunner('api', config);
      const failedListener = vi.fn();
      runner.on('failed', failedListener);

      await runner.start();

      // Simulate process failure
      mockProcess.emit('exit', 1, null);

      expect(failedListener).toHaveBeenCalledWith(1, null);
      expect(runner.status).toBe('failed');
      expect(runner.pid).toBeNull();
    });

    it('should handle exit-code ready check with success', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.exitCode = 0;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.catch = vi.fn((fn) => {
        fn();
        return Promise.resolve(mockProcess);
      });

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm run build',
        ready: {
          type: 'exit-code',
        },
      };

      const runner = new BashRunner('build', config);
      await runner.start();

      expect(runner.status).toBe('running');
    });

    it('should handle exit-code ready check with failure', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.exitCode = 1;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.catch = vi.fn((fn) => {
        fn();
        return Promise.resolve(mockProcess);
      });

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm run build',
        ready: {
          type: 'exit-code',
        },
      };

      const runner = new BashRunner('build', config);

      await expect(runner.start()).rejects.toThrow('Process exited with code 1');
      expect(runner.status).toBe('failed');
    });

    it('should throw error if already running', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
      };

      const runner = new BashRunner('api', config);
      await runner.start();

      await expect(runner.start()).rejects.toThrow('Process api is already running');
    });

    it('should set start time', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
      };

      const runner = new BashRunner('api', config);
      await runner.start();

      expect(runner.processStartTime).toBeInstanceOf(Date);
    });
  });

  describe('stop', () => {
    it('should stop a running process', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      mockProcess.then = Promise.resolve().then.bind(Promise.resolve());

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
      };

      const runner = new BashRunner('api', config);
      await runner.start();

      await runner.stop();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(runner.status).toBe('stopped');
      expect(runner.pid).toBeNull();
    });

    it('should do nothing if process is not running', async () => {
      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
      };

      const runner = new BashRunner('api', config);
      await runner.stop(); // Should not throw
    });

    it('should use SIGKILL if SIGTERM timeout', async () => {
      vi.useFakeTimers();

      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      mockProcess.then = new Promise(() => {}).then.bind(new Promise(() => {}));

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
      };

      const runner = new BashRunner('api', config);
      await runner.start();

      const stopPromise = runner.stop();

      // Advance time past the 10 second timeout
      await vi.advanceTimersByTimeAsync(11000);

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

      vi.useRealTimers();
    });

    it('should clear pid after stopping', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      mockProcess.then = Promise.resolve().then.bind(Promise.resolve());

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
      };

      const runner = new BashRunner('api', config);
      await runner.start();

      expect(runner.pid).toBe(12345);

      await runner.stop();

      expect(runner.pid).toBeNull();
    });

    it('should handle process errors during stop', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();

      // Create a rejected promise and catch it immediately to avoid unhandled rejection
      const rejectedPromise = Promise.reject(new Error('Process killed'));
      rejectedPromise.catch(() => {}); // Prevent unhandled rejection

      mockProcess.then = rejectedPromise.then.bind(rejectedPromise);
      mockProcess.catch = rejectedPromise.catch.bind(rejectedPromise);

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
      };

      const runner = new BashRunner('api', config);
      await runner.start();

      // Should not throw even if process rejects
      await runner.stop();

      expect(runner.status).toBe('stopped');
    });
  });
});
