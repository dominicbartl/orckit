import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { WebpackRunner } from '../../../src/runners/webpack.js';
import type { ProcessConfig } from '../../../src/types/index.js';

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock system utils
vi.mock('../../../src/utils/system.js', () => ({
  getProcessEnv: vi.fn((env) => ({ ...process.env, ...env })),
}));

describe('Webpack Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('start', () => {
    it('should start a webpack process', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
      await runner.start();

      expect(runner.status).toBe('building');
      expect(runner.pid).toBe(12345);
      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'webpack --watch'],
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
        command: 'webpack --watch',
        type: 'webpack',
        cwd: '/custom/path',
      };

      const runner = new WebpackRunner('webpack-dev', config);
      await runner.start();

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'webpack --watch'],
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
        command: 'webpack --watch',
        type: 'webpack',
        env: {
          NODE_ENV: 'production',
          WEBPACK_MODE: 'development',
        },
      };

      const runner = new WebpackRunner('webpack-dev', config);
      await runner.start();

      expect(getProcessEnv).toHaveBeenCalledWith({
        NODE_ENV: 'production',
        WEBPACK_MODE: 'development',
      });
    });

    it('should parse webpack build start', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
      const buildStartListener = vi.fn();
      runner.on('build:start', buildStartListener);

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from('webpack 5.0.0 compiling...\n'));

      expect(buildStartListener).toHaveBeenCalled();
      expect(runner.status).toBe('building');
    });

    it('should parse webpack build progress', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
      const buildProgressListener = vi.fn();
      runner.on('build:progress', buildProgressListener);

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from('50% building modules\n'));

      expect(buildProgressListener).toHaveBeenCalledWith({ progress: 50 });
    });

    it('should parse webpack build complete with no errors', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
      const buildCompleteListener = vi.fn();
      runner.on('build:complete', buildCompleteListener);

      await runner.start();

      mockProcess.stdout.emit(
        'data',
        Buffer.from('webpack 5.0.0 compiled successfully in 2500ms - 1.5 MB\n')
      );

      expect(buildCompleteListener).toHaveBeenCalled();
      expect(runner.status).toBe('running');
      expect(runner.buildInfo?.errors).toBe(0);
      expect(runner.buildInfo?.warnings).toBe(0);
      expect(runner.buildInfo?.lastBuildSuccess).toBe(true);
    });

    it('should parse webpack build complete with errors', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
      const buildCompleteListener = vi.fn();
      runner.on('build:complete', buildCompleteListener);

      await runner.start();

      mockProcess.stdout.emit(
        'data',
        Buffer.from('webpack 5.0.0 compiled with 3 error and 5 warning in 2500ms\n')
      );

      expect(buildCompleteListener).toHaveBeenCalled();
      expect(runner.status).toBe('failed');
      expect(runner.buildInfo?.errors).toBe(3);
      expect(runner.buildInfo?.warnings).toBe(5);
      expect(runner.buildInfo?.lastBuildSuccess).toBe(false);
    });

    it('should parse bundle size from webpack output', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
      await runner.start();

      mockProcess.stdout.emit(
        'data',
        Buffer.from('webpack 5.0.0 compiled successfully - 2.5 MB\n')
      );

      expect(runner.buildInfo?.size).toBe('2.5MB');
    });

    it('should detect build failure from error message', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
      const buildFailedListener = vi.fn();
      runner.on('build:failed', buildFailedListener);

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from('Failed to compile\n'));

      expect(buildFailedListener).toHaveBeenCalled();
      expect(runner.status).toBe('failed');
    });

    it('should detect build failure from ERROR in message', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
      const buildFailedListener = vi.fn();
      runner.on('build:failed', buildFailedListener);

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from('ERROR in ./src/index.js\n'));

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
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
      const stdoutListener = vi.fn();
      runner.on('stdout', stdoutListener);

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from('Webpack output\n'));

      expect(stdoutListener).toHaveBeenCalledWith('Webpack output\n');
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
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
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
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
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
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
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
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
      await runner.start();

      await expect(runner.start()).rejects.toThrow('Process webpack-dev is already running');
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
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
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
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
      await runner.start();

      await runner.stop();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(runner.status).toBe('stopped');
      expect(runner.pid).toBeNull();
    });

    it('should do nothing if process is not running', async () => {
      const config: ProcessConfig = {
        category: 'frontend',
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
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
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
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
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = new WebpackRunner('webpack-dev', config);
      await runner.start();

      // Should not throw even if process rejects
      await runner.stop();

      expect(runner.status).toBe('stopped');
    });
  });
});
