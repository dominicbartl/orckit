import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { ViteRunner } from '../../../src/runners/vite.js';
import type { ProcessConfig } from '../../../src/types/index.js';

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock system utils
vi.mock('../../../src/utils/system.js', () => ({
  getProcessEnv: vi.fn((env) => ({ ...process.env, ...env })),
}));

describe('Vite Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('start', () => {
    it('should start a vite process', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
      await runner.start();

      expect(runner.status).toBe('building');
      expect(runner.pid).toBe(12345);
      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'vite'],
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
        category: 'frontend',
        command: 'vite',
        type: 'vite',
        cwd: '/custom/path',
      };

      const runner = new ViteRunner('vite-dev', config);
      await runner.start();

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'vite'],
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
        category: 'frontend',
        command: 'vite',
        type: 'vite',
        env: {
          NODE_ENV: 'development',
          VITE_API_URL: 'http://localhost:3000',
        },
      };

      const runner = new ViteRunner('vite-dev', config);
      await runner.start();

      expect(getProcessEnv).toHaveBeenCalledWith({
        NODE_ENV: 'development',
        VITE_API_URL: 'http://localhost:3000',
      });
    });

    it('should parse vite dev server ready with Local:', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from('  Local:   http://localhost:5173/\n'));

      expect(runner.status).toBe('running');
    });

    it('should parse vite dev server ready with timing', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
      const buildCompleteListener = vi.fn();
      runner.on('build:complete', buildCompleteListener);

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from('ready in 450 ms\n'));

      expect(runner.status).toBe('running');
      expect(buildCompleteListener).toHaveBeenCalledWith({ duration: 450 });
      expect(runner.buildInfo?.duration).toBe(450);
      expect(runner.buildInfo?.errors).toBe(0);
      expect(runner.buildInfo?.warnings).toBe(0);
      expect(runner.buildInfo?.lastBuildSuccess).toBe(true);
    });

    it('should detect page reload rebuild', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
      const buildStartListener = vi.fn();
      runner.on('build:start', buildStartListener);

      await runner.start();

      // First set to running
      mockProcess.stdout.emit('data', Buffer.from('  Local:   http://localhost:5173/\n'));

      // Then detect rebuild
      mockProcess.stdout.emit('data', Buffer.from('page reload src/main.ts\n'));

      expect(buildStartListener).toHaveBeenCalled();
      expect(runner.status).toBe('building');
    });

    it('should detect hmr update rebuild', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
      const buildStartListener = vi.fn();
      runner.on('build:start', buildStartListener);

      await runner.start();

      // First set to running
      mockProcess.stdout.emit('data', Buffer.from('ready in 450 ms\n'));

      // Then detect rebuild
      mockProcess.stdout.emit('data', Buffer.from('hmr update /src/App.vue\n'));

      expect(buildStartListener).toHaveBeenCalled();
      expect(runner.status).toBe('building');
    });

    it('should detect errors from ERROR keyword', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
      const buildFailedListener = vi.fn();
      runner.on('build:failed', buildFailedListener);

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from('ERROR: Failed to resolve import\n'));

      expect(buildFailedListener).toHaveBeenCalled();
      expect(runner.status).toBe('failed');
    });

    it('should detect errors from lowercase error keyword', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
      const buildFailedListener = vi.fn();
      runner.on('build:failed', buildFailedListener);

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from('[vite] error while loading config\n'));

      expect(buildFailedListener).toHaveBeenCalled();
      expect(runner.status).toBe('failed');
    });

    it('should emit stdout events', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
      const stdoutListener = vi.fn();
      runner.on('stdout', stdoutListener);

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from('Vite output\n'));

      expect(stdoutListener).toHaveBeenCalledWith('Vite output\n');
    });

    it('should emit stderr events', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
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
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
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
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
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
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
      await runner.start();

      await expect(runner.start()).rejects.toThrow('Process vite-dev is already running');
    });

    it('should set start time', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
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
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
      await runner.start();

      await runner.stop();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(runner.status).toBe('stopped');
      expect(runner.pid).toBeNull();
    });

    it('should do nothing if process is not running', async () => {
      const config: ProcessConfig = {
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
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
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
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
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = new ViteRunner('vite-dev', config);
      await runner.start();

      // Should not throw even if process rejects
      await runner.stop();

      expect(runner.status).toBe('stopped');
    });
  });
});
