import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { DockerRunner } from '../../../src/runners/docker.js';
import type { ProcessConfig } from '../../../src/types/index.js';

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock system utils
vi.mock('../../../src/utils/system.js', () => ({
  getProcessEnv: vi.fn((env) => ({ ...process.env, ...env })),
}));

describe('Docker Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('start', () => {
    it('should start a docker process', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'infrastructure',
        command: 'docker run postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      await runner.start();

      expect(runner.status).toBe('running');
      expect(runner.pid).toBe(12345);
      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'docker run postgres'],
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
        category: 'infrastructure',
        command: 'docker run postgres',
        type: 'docker',
        cwd: '/custom/path',
      };

      const runner = new DockerRunner('postgres', config);
      await runner.start();

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'docker run postgres'],
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
        category: 'infrastructure',
        command: 'docker run postgres',
        type: 'docker',
        env: {
          POSTGRES_PASSWORD: 'secret',
          POSTGRES_DB: 'mydb',
        },
      };

      const runner = new DockerRunner('postgres', config);
      await runner.start();

      expect(getProcessEnv).toHaveBeenCalledWith({
        POSTGRES_PASSWORD: 'secret',
        POSTGRES_DB: 'mydb',
      });
    });

    it('should capture container ID from stdout', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'infrastructure',
        command: 'docker run -d postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      await runner.start();

      // Simulate Docker outputting container ID
      const containerId = 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd';
      mockProcess.stdout.emit('data', Buffer.from(containerId + '\n'));

      // Container ID should be captured internally (no direct getter, but affects stop behavior)
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
        category: 'infrastructure',
        command: 'docker run postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      const stdoutListener = vi.fn();
      runner.on('stdout', stdoutListener);

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from('Container started\n'));

      expect(stdoutListener).toHaveBeenCalledWith('Container started');
    });

    it('should emit stderr events', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'infrastructure',
        command: 'docker run postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      const stderrListener = vi.fn();
      runner.on('stderr', stderrListener);

      await runner.start();

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
        category: 'infrastructure',
        command: 'docker run postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      const exitListener = vi.fn();
      runner.on('exit', exitListener);

      await runner.start();

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
        category: 'infrastructure',
        command: 'docker run postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      const failedListener = vi.fn();
      runner.on('failed', failedListener);

      await runner.start();

      mockProcess.emit('exit', 1, null);

      expect(failedListener).toHaveBeenCalledWith(1, null);
      expect(runner.status).toBe('failed');
      expect(runner.pid).toBeNull();
    });

    it('should throw error if already running', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'infrastructure',
        command: 'docker run postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      await runner.start();

      await expect(runner.start()).rejects.toThrow('Process postgres is already running');
    });

    it('should set start time', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'infrastructure',
        command: 'docker run postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      await runner.start();

      expect(runner.processStartTime).toBeInstanceOf(Date);
    });

    it('should set status to starting then running', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'infrastructure',
        command: 'docker run postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      const statusChanges: string[] = [];

      runner.on('status', (status) => statusChanges.push(status));

      await runner.start();

      expect(statusChanges).toContain('starting');
      expect(statusChanges).toContain('running');
      expect(runner.status).toBe('running');
    });
  });

  describe('stop', () => {
    it('should stop a running container gracefully', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      mockProcess.then = Promise.resolve().then.bind(Promise.resolve());

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'infrastructure',
        command: 'docker run -d postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      await runner.start();

      // Simulate container ID capture
      const containerId = 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd';
      mockProcess.stdout.emit('data', Buffer.from(containerId + '\n'));

      // Setup stop, rm mocks
      vi.mocked(execa)
        .mockResolvedValueOnce({} as any) // docker stop
        .mockResolvedValueOnce({} as any); // docker rm

      await runner.stop();

      expect(execa).toHaveBeenCalledWith('docker', ['stop', containerId], { timeout: 10000 });
      expect(execa).toHaveBeenCalledWith('docker', ['rm', containerId]);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(runner.status).toBe('stopped');
      expect(runner.pid).toBeNull();
    });

    it('should use docker kill if stop fails', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      mockProcess.then = Promise.resolve().then.bind(Promise.resolve());

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'infrastructure',
        command: 'docker run -d postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      await runner.start();

      const containerId = 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd';
      mockProcess.stdout.emit('data', Buffer.from(containerId + '\n'));

      // Mock stop failing, kill succeeding, rm succeeding
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('Stop timeout')) // docker stop fails
        .mockResolvedValueOnce({} as any) // docker kill succeeds
        .mockResolvedValueOnce({} as any); // docker rm succeeds

      await runner.stop();

      expect(execa).toHaveBeenCalledWith('docker', ['stop', containerId], { timeout: 10000 });
      expect(execa).toHaveBeenCalledWith('docker', ['kill', containerId]);
      expect(execa).toHaveBeenCalledWith('docker', ['rm', containerId]);
    });

    it('should handle docker kill failure gracefully', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      mockProcess.then = Promise.resolve().then.bind(Promise.resolve());

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'infrastructure',
        command: 'docker run -d postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      await runner.start();

      const containerId = 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd';
      mockProcess.stdout.emit('data', Buffer.from(containerId + '\n'));

      // Mock all docker commands failing
      vi.mocked(execa)
        .mockRejectedValueOnce(new Error('Stop failed'))
        .mockRejectedValueOnce(new Error('Kill failed'))
        .mockRejectedValueOnce(new Error('Rm failed'));

      // Should not throw
      await runner.stop();

      expect(runner.status).toBe('stopped');
    });

    it('should handle docker rm failure gracefully', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      mockProcess.then = Promise.resolve().then.bind(Promise.resolve());

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'infrastructure',
        command: 'docker run -d postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      await runner.start();

      const containerId = 'a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd';
      mockProcess.stdout.emit('data', Buffer.from(containerId + '\n'));

      // Mock stop and kill succeeding, rm failing
      vi.mocked(execa)
        .mockResolvedValueOnce({} as any) // docker stop
        .mockRejectedValueOnce(new Error('Rm failed')); // docker rm fails

      // Should not throw
      await runner.stop();

      expect(runner.status).toBe('stopped');
    });

    it('should do nothing if process is not running', async () => {
      const config: ProcessConfig = {
        category: 'infrastructure',
        command: 'docker run postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      await runner.stop(); // Should not throw
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
        category: 'infrastructure',
        command: 'docker run postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
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

      const rejectedPromise = Promise.reject(new Error('Process killed'));
      rejectedPromise.catch(() => {});

      mockProcess.then = rejectedPromise.then.bind(rejectedPromise);
      mockProcess.catch = rejectedPromise.catch.bind(rejectedPromise);

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'infrastructure',
        command: 'docker run postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      await runner.start();

      // Should not throw even if process rejects
      await runner.stop();

      expect(runner.status).toBe('stopped');
    });

    it('should stop process without container ID if not captured', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockProcess.kill = vi.fn();
      mockProcess.then = Promise.resolve().then.bind(Promise.resolve());

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'infrastructure',
        command: 'docker run postgres',
        type: 'docker',
      };

      const runner = new DockerRunner('postgres', config);
      await runner.start();

      // Don't emit container ID
      await runner.stop();

      // Should still kill the process
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(runner.status).toBe('stopped');
    });
  });
});
