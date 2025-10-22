import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { AngularRunner } from '../../../src/runners/angular.js';
import type { ProcessConfig } from '../../../src/types/index.js';

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock system utils
vi.mock('../../../src/utils/system.js', () => ({
  getProcessEnv: vi.fn((env) => ({ ...process.env, ...env })),
}));

describe('Angular Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('start', () => {
    it('should start an angular process', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular-app', config);
      await runner.start();

      expect(runner.status).toBe('building');
      expect(runner.pid).toBe(12345);
      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'ng serve'],
        expect.objectContaining({
          cwd: process.cwd(),
          reject: false,
          all: true,
        })
      );
    });

    it('should add --progress=false for deep integration mode', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng serve',
        type: 'angular',
        integration: {
          mode: 'deep',
        },
      };

      const runner = new AngularRunner('angular-app', config);
      await runner.start();

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'ng serve --progress=false'],
        expect.any(Object)
      );
    });

    it('should not add --progress=false if already has --json', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng serve --json',
        type: 'angular',
        integration: {
          mode: 'deep',
        },
      };

      const runner = new AngularRunner('angular-app', config);
      await runner.start();

      expect(execa).toHaveBeenCalledWith('bash', ['-c', 'ng serve --json'], expect.any(Object));
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
        command: 'ng serve',
        type: 'angular',
        cwd: '/custom/path',
      };

      const runner = new AngularRunner('angular-app', config);
      await runner.start();

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'ng serve'],
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
        command: 'ng serve',
        type: 'angular',
        env: {
          NODE_ENV: 'production',
          NG_BUILD_CACHE: 'false',
        },
      };

      const runner = new AngularRunner('angular-app', config);
      await runner.start();

      expect(getProcessEnv).toHaveBeenCalledWith({
        NODE_ENV: 'production',
        NG_BUILD_CACHE: 'false',
      });
    });

    describe('JSON mode parsing', () => {
      it('should parse build-start event', async () => {
        const { execa } = await import('execa');
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 12345;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const config: ProcessConfig = {
          category: 'frontend',
          command: 'ng serve',
          type: 'angular',
          integration: { mode: 'deep' },
        };

        const runner = new AngularRunner('angular-app', config);
        const buildStartListener = vi.fn();
        runner.on('build:start', buildStartListener);

        await runner.start();

        const event = JSON.stringify({ type: 'build-start' });
        mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

        expect(buildStartListener).toHaveBeenCalled();
        expect(runner.status).toBe('building');
      });

      it('should parse build-progress event', async () => {
        const { execa } = await import('execa');
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 12345;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const config: ProcessConfig = {
          category: 'frontend',
          command: 'ng serve',
          type: 'angular',
          integration: { mode: 'deep' },
        };

        const runner = new AngularRunner('angular-app', config);
        const buildProgressListener = vi.fn();
        runner.on('build:progress', buildProgressListener);

        await runner.start();

        const event = JSON.stringify({
          type: 'build-progress',
          progress: 65,
          message: 'Building modules',
        });
        mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

        expect(buildProgressListener).toHaveBeenCalledWith({
          progress: 65,
          message: 'Building modules',
        });
      });

      it('should parse build-complete event with success', async () => {
        const { execa } = await import('execa');
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 12345;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const config: ProcessConfig = {
          category: 'frontend',
          command: 'ng serve',
          type: 'angular',
          integration: { mode: 'deep' },
        };

        const runner = new AngularRunner('angular-app', config);
        const buildCompleteListener = vi.fn();
        runner.on('build:complete', buildCompleteListener);

        await runner.start();

        const event = JSON.stringify({
          type: 'build-complete',
          success: true,
          time: 3500,
          errors: [],
          warnings: [],
        });
        mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

        expect(buildCompleteListener).toHaveBeenCalled();
        expect(runner.status).toBe('running');
        expect(runner.buildInfo?.duration).toBe(3500);
        expect(runner.buildInfo?.errors).toBe(0);
        expect(runner.buildInfo?.warnings).toBe(0);
        expect(runner.buildInfo?.lastBuildSuccess).toBe(true);
      });

      it('should parse build-complete event with errors', async () => {
        const { execa } = await import('execa');
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 12345;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const config: ProcessConfig = {
          category: 'frontend',
          command: 'ng serve',
          type: 'angular',
          integration: { mode: 'deep' },
        };

        const runner = new AngularRunner('angular-app', config);
        const buildCompleteListener = vi.fn();
        runner.on('build:complete', buildCompleteListener);

        await runner.start();

        const event = JSON.stringify({
          type: 'build-complete',
          success: false,
          time: 2000,
          errors: ['Error 1', 'Error 2'],
          warnings: ['Warning 1'],
        });
        mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

        expect(buildCompleteListener).toHaveBeenCalled();
        expect(runner.status).toBe('failed');
        expect(runner.buildInfo?.errors).toBe(2);
        expect(runner.buildInfo?.warnings).toBe(1);
        expect(runner.buildInfo?.lastBuildSuccess).toBe(false);
      });

      it('should parse build-error event', async () => {
        const { execa } = await import('execa');
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 12345;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const config: ProcessConfig = {
          category: 'frontend',
          command: 'ng serve',
          type: 'angular',
          integration: { mode: 'deep' },
        };

        const runner = new AngularRunner('angular-app', config);
        const buildFailedListener = vi.fn();
        runner.on('build:failed', buildFailedListener);

        await runner.start();

        const event = JSON.stringify({ type: 'build-error' });
        mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

        expect(buildFailedListener).toHaveBeenCalled();
        expect(runner.status).toBe('failed');
      });

      it('should ignore non-JSON lines in deep mode', async () => {
        const { execa } = await import('execa');
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 12345;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const config: ProcessConfig = {
          category: 'frontend',
          command: 'ng serve',
          type: 'angular',
          integration: { mode: 'deep' },
        };

        const runner = new AngularRunner('angular-app', config);
        await runner.start();

        // Should not crash on non-JSON line
        mockProcess.stdout.emit('data', Buffer.from('Some text output\n'));

        expect(runner.status).toBe('building');
      });
    });

    describe('Text mode parsing', () => {
      it('should parse Compiling as build start', async () => {
        const { execa } = await import('execa');
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 12345;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const config: ProcessConfig = {
          category: 'frontend',
          command: 'ng serve',
          type: 'angular',
        };

        const runner = new AngularRunner('angular-app', config);
        const buildStartListener = vi.fn();
        runner.on('build:start', buildStartListener);

        await runner.start();

        mockProcess.stdout.emit('data', Buffer.from('Compiling @angular/core\n'));

        expect(buildStartListener).toHaveBeenCalled();
        expect(runner.status).toBe('building');
      });

      it('should parse Building as build start', async () => {
        const { execa } = await import('execa');
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 12345;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const config: ProcessConfig = {
          category: 'frontend',
          command: 'ng serve',
          type: 'angular',
        };

        const runner = new AngularRunner('angular-app', config);
        const buildStartListener = vi.fn();
        runner.on('build:start', buildStartListener);

        await runner.start();

        mockProcess.stdout.emit('data', Buffer.from('Building Angular app\n'));

        expect(buildStartListener).toHaveBeenCalled();
      });

      it('should parse progress percentage', async () => {
        const { execa } = await import('execa');
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 12345;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const config: ProcessConfig = {
          category: 'frontend',
          command: 'ng serve',
          type: 'angular',
        };

        const runner = new AngularRunner('angular-app', config);
        const buildProgressListener = vi.fn();
        runner.on('build:progress', buildProgressListener);

        await runner.start();

        mockProcess.stdout.emit('data', Buffer.from('75% building modules\n'));

        expect(buildProgressListener).toHaveBeenCalledWith({ progress: 75 });
      });

      it('should detect successful compilation', async () => {
        const { execa } = await import('execa');
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 12345;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const config: ProcessConfig = {
          category: 'frontend',
          command: 'ng serve',
          type: 'angular',
        };

        const runner = new AngularRunner('angular-app', config);
        const buildCompleteListener = vi.fn();
        runner.on('build:complete', buildCompleteListener);

        await runner.start();

        mockProcess.stdout.emit('data', Buffer.from('Compiled successfully.\n'));

        expect(buildCompleteListener).toHaveBeenCalled();
        expect(runner.status).toBe('running');
        expect(runner.buildInfo?.errors).toBe(0);
        expect(runner.buildInfo?.warnings).toBe(0);
        expect(runner.buildInfo?.lastBuildSuccess).toBe(true);
      });

      it('should detect build complete', async () => {
        const { execa } = await import('execa');
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 12345;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const config: ProcessConfig = {
          category: 'frontend',
          command: 'ng build',
          type: 'angular',
        };

        const runner = new AngularRunner('angular-build', config);
        const buildCompleteListener = vi.fn();
        runner.on('build:complete', buildCompleteListener);

        await runner.start();

        mockProcess.stdout.emit('data', Buffer.from('Build complete\n'));

        expect(buildCompleteListener).toHaveBeenCalled();
        expect(runner.status).toBe('running');
      });

      it('should detect ERROR', async () => {
        const { execa } = await import('execa');
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 12345;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const config: ProcessConfig = {
          category: 'frontend',
          command: 'ng serve',
          type: 'angular',
        };

        const runner = new AngularRunner('angular-app', config);
        const buildFailedListener = vi.fn();
        runner.on('build:failed', buildFailedListener);

        await runner.start();

        mockProcess.stdout.emit('data', Buffer.from('ERROR in src/app/app.component.ts\n'));

        expect(buildFailedListener).toHaveBeenCalled();
        expect(runner.status).toBe('failed');
      });

      it('should detect failed compilation', async () => {
        const { execa } = await import('execa');
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 12345;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const config: ProcessConfig = {
          category: 'frontend',
          command: 'ng serve',
          type: 'angular',
        };

        const runner = new AngularRunner('angular-app', config);
        const buildFailedListener = vi.fn();
        runner.on('build:failed', buildFailedListener);

        await runner.start();

        mockProcess.stdout.emit('data', Buffer.from('Failed to compile\n'));

        expect(buildFailedListener).toHaveBeenCalled();
        expect(runner.status).toBe('failed');
      });
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
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular-app', config);
      const stdoutListener = vi.fn();
      runner.on('stdout', stdoutListener);

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from('Angular output\n'));

      expect(stdoutListener).toHaveBeenCalledWith('Angular output\n');
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
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular-app', config);
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
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular-app', config);
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
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular-app', config);
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
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular-app', config);
      await runner.start();

      await expect(runner.start()).rejects.toThrow('Process angular-app is already running');
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
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular-app', config);
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
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular-app', config);
      await runner.start();

      await runner.stop();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(runner.status).toBe('stopped');
      expect(runner.pid).toBeNull();
    });

    it('should do nothing if process is not running', async () => {
      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular-app', config);
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
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular-app', config);
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
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular-app', config);
      await runner.start();

      // Should not throw even if process rejects
      await runner.stop();

      expect(runner.status).toBe('stopped');
    });
  });
});
