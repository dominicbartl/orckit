import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  executeHook,
  executeProcessHooks,
  executeGlobalHooks,
  type HookResult,
} from '../../../../src/core/hooks/executor.js';
import type { ProcessHooks, GlobalHooks } from '../../../../src/types/index.js';

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

describe('Hooks Executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeHook', () => {
    it('should execute hook command successfully', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'Hook output',
      } as any);

      const result = await executeHook('echo "Hello"');

      expect(result.success).toBe(true);
      expect(result.output).toBe('Hook output');
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'echo "Hello"'],
        expect.objectContaining({
          timeout: 30000,
          all: true,
        })
      );
    });

    it('should use custom working directory', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      await executeHook('npm install', '/custom/path');

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'npm install'],
        expect.objectContaining({
          cwd: '/custom/path',
        })
      );
    });

    it('should use default working directory if not provided', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      await executeHook('echo "test"');

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'echo "test"'],
        expect.objectContaining({
          cwd: process.cwd(),
        })
      );
    });

    it('should use custom timeout', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      await executeHook('slow command', undefined, 60000);

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'slow command'],
        expect.objectContaining({
          timeout: 60000,
        })
      );
    });

    it('should use default timeout of 30 seconds', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      await executeHook('command');

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'command'],
        expect.objectContaining({
          timeout: 30000,
        })
      );
    });

    it('should handle hook failure', async () => {
      const { execa } = await import('execa');
      const error = new Error('Command failed');
      vi.mocked(execa).mockRejectedValue(error);

      const result = await executeHook('failing command');

      expect(result.success).toBe(false);
      expect(result.error).toBe(error);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.output).toBeUndefined();
    });

    it('should handle non-Error exceptions', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValue('String error');

      const result = await executeHook('failing command');

      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe('String error');
    });

    it('should measure execution duration', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockImplementation(() =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ all: 'output' } as any), 100)
        )
      );

      const result = await executeHook('slow command');

      expect(result.duration).toBeGreaterThanOrEqual(90);
      expect(result.duration).toBeLessThan(200);
    });
  });

  describe('executeProcessHooks', () => {
    it('should execute pre_start hook', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'Hook executed',
      } as any);

      const hooks: ProcessHooks = {
        pre_start: 'npm install',
      };

      await executeProcessHooks(hooks, 'pre_start', '/project');

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'npm install'],
        expect.objectContaining({
          cwd: '/project',
        })
      );
    });

    it('should execute post_start hook', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      const hooks: ProcessHooks = {
        post_start: 'echo "Started"',
      };

      await executeProcessHooks(hooks, 'post_start');

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'echo "Started"'],
        expect.any(Object)
      );
    });

    it('should execute pre_stop hook', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      const hooks: ProcessHooks = {
        pre_stop: 'npm run cleanup',
      };

      await executeProcessHooks(hooks, 'pre_stop');

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'npm run cleanup'],
        expect.any(Object)
      );
    });

    it('should execute post_stop hook', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      const hooks: ProcessHooks = {
        post_stop: 'echo "Stopped"',
      };

      await executeProcessHooks(hooks, 'post_stop');

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'echo "Stopped"'],
        expect.any(Object)
      );
    });

    it('should do nothing if hooks is undefined', async () => {
      const { execa } = await import('execa');

      await executeProcessHooks(undefined, 'pre_start');

      expect(execa).not.toHaveBeenCalled();
    });

    it('should do nothing if specific hook is not defined', async () => {
      const { execa } = await import('execa');

      const hooks: ProcessHooks = {
        pre_start: 'echo "pre"',
      };

      await executeProcessHooks(hooks, 'post_start');

      expect(execa).not.toHaveBeenCalled();
    });

    it('should call onHookStart callback', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      const hooks: ProcessHooks = {
        pre_start: 'npm install',
      };

      const onHookStart = vi.fn();

      await executeProcessHooks(hooks, 'pre_start', undefined, onHookStart);

      expect(onHookStart).toHaveBeenCalledWith('pre_start', 'npm install');
    });

    it('should call onHookComplete callback', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      const hooks: ProcessHooks = {
        pre_start: 'npm install',
      };

      const onHookComplete = vi.fn();

      await executeProcessHooks(hooks, 'pre_start', undefined, undefined, onHookComplete);

      expect(onHookComplete).toHaveBeenCalledWith(
        'pre_start',
        expect.objectContaining({
          success: true,
          output: 'output',
        })
      );
    });

    it('should throw error if hook fails', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValue(new Error('Installation failed'));

      const hooks: ProcessHooks = {
        pre_start: 'npm install',
      };

      await expect(executeProcessHooks(hooks, 'pre_start')).rejects.toThrow(
        "Hook 'pre_start' failed: Installation failed"
      );
    });

    it('should call both callbacks even on failure', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValue(new Error('Failed'));

      const hooks: ProcessHooks = {
        pre_start: 'npm install',
      };

      const onHookStart = vi.fn();
      const onHookComplete = vi.fn();

      try {
        await executeProcessHooks(hooks, 'pre_start', undefined, onHookStart, onHookComplete);
      } catch {
        // Expected
      }

      expect(onHookStart).toHaveBeenCalled();
      expect(onHookComplete).toHaveBeenCalledWith(
        'pre_start',
        expect.objectContaining({
          success: false,
        })
      );
    });
  });

  describe('executeGlobalHooks', () => {
    it('should execute pre_start_all hook', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      const hooks: GlobalHooks = {
        pre_start_all: 'docker-compose up -d',
      };

      await executeGlobalHooks(hooks, 'pre_start_all');

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'docker-compose up -d'],
        expect.any(Object)
      );
    });

    it('should execute post_start_all hook', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      const hooks: GlobalHooks = {
        post_start_all: 'echo "All started"',
      };

      await executeGlobalHooks(hooks, 'post_start_all');

      expect(execa).toHaveBeenCalled();
    });

    it('should execute pre_stop_all hook', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      const hooks: GlobalHooks = {
        pre_stop_all: 'echo "Stopping all"',
      };

      await executeGlobalHooks(hooks, 'pre_stop_all');

      expect(execa).toHaveBeenCalled();
    });

    it('should execute post_stop_all hook', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      const hooks: GlobalHooks = {
        post_stop_all: 'docker-compose down',
      };

      await executeGlobalHooks(hooks, 'post_stop_all');

      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'docker-compose down'],
        expect.any(Object)
      );
    });

    it('should do nothing if hooks is undefined', async () => {
      const { execa } = await import('execa');

      await executeGlobalHooks(undefined, 'pre_start_all');

      expect(execa).not.toHaveBeenCalled();
    });

    it('should do nothing if specific hook is not defined', async () => {
      const { execa } = await import('execa');

      const hooks: GlobalHooks = {
        pre_start_all: 'echo "pre"',
      };

      await executeGlobalHooks(hooks, 'post_start_all');

      expect(execa).not.toHaveBeenCalled();
    });

    it('should call onHookStart callback', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      const hooks: GlobalHooks = {
        pre_start_all: 'docker-compose up',
      };

      const onHookStart = vi.fn();

      await executeGlobalHooks(hooks, 'pre_start_all', onHookStart);

      expect(onHookStart).toHaveBeenCalledWith('pre_start_all', 'docker-compose up');
    });

    it('should call onHookComplete callback', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      const hooks: GlobalHooks = {
        pre_start_all: 'docker-compose up',
      };

      const onHookComplete = vi.fn();

      await executeGlobalHooks(hooks, 'pre_start_all', undefined, onHookComplete);

      expect(onHookComplete).toHaveBeenCalledWith(
        'pre_start_all',
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('should throw error if hook fails', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValue(new Error('Docker failed'));

      const hooks: GlobalHooks = {
        pre_start_all: 'docker-compose up',
      };

      await expect(executeGlobalHooks(hooks, 'pre_start_all')).rejects.toThrow(
        "Global hook 'pre_start_all' failed: Docker failed"
      );
    });

    it('should use default cwd for global hooks', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        all: 'output',
      } as any);

      const hooks: GlobalHooks = {
        pre_start_all: 'echo "test"',
      };

      await executeGlobalHooks(hooks, 'pre_start_all');

      // Global hooks use default cwd from executeHook
      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'echo "test"'],
        expect.objectContaining({
          cwd: process.cwd(),
        })
      );
    });
  });
});
