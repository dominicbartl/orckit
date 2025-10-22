import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MaestroWebpackPlugin } from '../../../src/plugins/webpack.js';
import type { MaestroWebpackPluginOptions } from '../../../src/plugins/webpack.js';

describe('Webpack Plugin', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('MaestroWebpackPlugin', () => {
    it('should create plugin instance', () => {
      const options: MaestroWebpackPluginOptions = {
        processName: 'webpack',
      };

      const plugin = new MaestroWebpackPlugin(options);

      expect(plugin).toBeDefined();
    });

    it('should register hooks with compiler', () => {
      const options: MaestroWebpackPluginOptions = {
        processName: 'webpack',
        reportProgress: false,
      };

      const plugin = new MaestroWebpackPlugin(options);

      const mockCompiler = {
        hooks: {
          compile: { tap: vi.fn() },
          done: { tap: vi.fn() },
        },
        webpack: {
          ProgressPlugin: vi.fn(),
        },
      };

      plugin.apply(mockCompiler as any);

      expect(mockCompiler.hooks.compile.tap).toHaveBeenCalledWith(
        'MaestroWebpackPlugin',
        expect.any(Function)
      );
      expect(mockCompiler.hooks.done.tap).toHaveBeenCalledWith(
        'MaestroWebpackPlugin',
        expect.any(Function)
      );
    });

    it('should emit build:start event on compile', () => {
      const options: MaestroWebpackPluginOptions = {
        processName: 'webpack',
        reportProgress: false,
      };

      const plugin = new MaestroWebpackPlugin(options);

      let compileHandler: (() => void) | undefined;
      const mockCompiler = {
        hooks: {
          compile: {
            tap: vi.fn((name: string, handler: () => void) => {
              compileHandler = handler;
            }),
          },
          done: { tap: vi.fn() },
        },
        webpack: {
          ProgressPlugin: vi.fn(),
        },
      };

      plugin.apply(mockCompiler as any);

      // Trigger compile hook
      compileHandler!();

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[ORCKIT_EVENT]');
      expect(output).toContain('build:start');
      expect(output).toContain('webpack');
    });

    it('should emit build:complete on successful build', () => {
      const options: MaestroWebpackPluginOptions = {
        processName: 'webpack',
        reportProgress: false,
      };

      const plugin = new MaestroWebpackPlugin(options);

      let doneHandler: ((stats: any) => void) | undefined;
      const mockCompiler = {
        hooks: {
          compile: { tap: vi.fn() },
          done: {
            tap: vi.fn((name: string, handler: (stats: any) => void) => {
              doneHandler = handler;
            }),
          },
        },
        webpack: {
          ProgressPlugin: vi.fn(),
        },
      };

      plugin.apply(mockCompiler as any);

      // Trigger done hook with successful stats
      const mockStats = {
        hasErrors: () => false,
        startTime: 1000,
        endTime: 3500,
        hash: 'abc123',
        compilation: {
          errors: [],
          warnings: [],
        },
      };

      doneHandler!(mockStats);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[ORCKIT_EVENT]');
      expect(output).toContain('build:complete');
      expect(output).toContain('"success":true');
      expect(output).toContain('"duration":2500');
      expect(output).toContain('abc123');
    });

    it('should emit build:failed on failed build', () => {
      const options: MaestroWebpackPluginOptions = {
        processName: 'webpack',
        reportProgress: false,
      };

      const plugin = new MaestroWebpackPlugin(options);

      let doneHandler: ((stats: any) => void) | undefined;
      const mockCompiler = {
        hooks: {
          compile: { tap: vi.fn() },
          done: {
            tap: vi.fn((name: string, handler: (stats: any) => void) => {
              doneHandler = handler;
            }),
          },
        },
        webpack: {
          ProgressPlugin: vi.fn(),
        },
      };

      plugin.apply(mockCompiler as any);

      // Trigger done hook with failed stats
      const mockStats = {
        hasErrors: () => true,
        startTime: 1000,
        endTime: 2000,
        hash: 'def456',
        compilation: {
          errors: ['Error 1', 'Error 2'],
          warnings: ['Warning 1'],
        },
      };

      doneHandler!(mockStats);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[ORCKIT_EVENT]');
      expect(output).toContain('build:failed');
      expect(output).toContain('"success":false');
      expect(output).toContain('"errors":2');
      expect(output).toContain('"warnings":1');
    });

    it('should register progress plugin when reportProgress is true', () => {
      const options: MaestroWebpackPluginOptions = {
        processName: 'webpack',
        reportProgress: true,
      };

      const plugin = new MaestroWebpackPlugin(options);

      const mockProgressPlugin = {
        apply: vi.fn(),
      };

      const mockCompiler = {
        hooks: {
          compile: { tap: vi.fn() },
          done: { tap: vi.fn() },
        },
        webpack: {
          ProgressPlugin: vi.fn(() => mockProgressPlugin),
        },
      };

      plugin.apply(mockCompiler as any);

      expect(mockCompiler.webpack.ProgressPlugin).toHaveBeenCalled();
      expect(mockProgressPlugin.apply).toHaveBeenCalledWith(mockCompiler);
    });

    it('should emit progress events', () => {
      const options: MaestroWebpackPluginOptions = {
        processName: 'webpack',
        reportProgress: true,
      };

      const plugin = new MaestroWebpackPlugin(options);

      let progressCallback: ((percentage: number, msg: string) => void) | undefined;
      const mockProgressPlugin = {
        apply: vi.fn(),
      };

      const mockCompiler = {
        hooks: {
          compile: { tap: vi.fn() },
          done: { tap: vi.fn() },
        },
        webpack: {
          ProgressPlugin: vi.fn((callback: (percentage: number, msg: string) => void) => {
            progressCallback = callback;
            return mockProgressPlugin;
          }),
        },
      };

      plugin.apply(mockCompiler as any);

      // Trigger progress callback
      progressCallback!(0.5, 'building modules');

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[ORCKIT_EVENT]');
      expect(output).toContain('build:progress');
      expect(output).toContain('"progress":50');
      expect(output).toContain('building modules');
    });

    it('should not register progress plugin when reportProgress is false', () => {
      const options: MaestroWebpackPluginOptions = {
        processName: 'webpack',
        reportProgress: false,
      };

      const plugin = new MaestroWebpackPlugin(options);

      const mockCompiler = {
        hooks: {
          compile: { tap: vi.fn() },
          done: { tap: vi.fn() },
        },
        webpack: {
          ProgressPlugin: vi.fn(),
        },
      };

      plugin.apply(mockCompiler as any);

      expect(mockCompiler.webpack.ProgressPlugin).not.toHaveBeenCalled();
    });

    it('should handle stats without timing info', () => {
      const options: MaestroWebpackPluginOptions = {
        processName: 'webpack',
        reportProgress: false,
      };

      const plugin = new MaestroWebpackPlugin(options);

      let doneHandler: ((stats: any) => void) | undefined;
      const mockCompiler = {
        hooks: {
          compile: { tap: vi.fn() },
          done: {
            tap: vi.fn((name: string, handler: (stats: any) => void) => {
              doneHandler = handler;
            }),
          },
        },
        webpack: {
          ProgressPlugin: vi.fn(),
        },
      };

      plugin.apply(mockCompiler as any);

      // Trigger done hook with stats missing timing
      const mockStats = {
        hasErrors: () => false,
        hash: 'xyz789',
        compilation: {
          errors: [],
          warnings: [],
        },
      };

      doneHandler!(mockStats);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('"duration":0');
    });
  });

  describe('MaestroWebpackPluginOptions', () => {
    it('should allow valid options', () => {
      const options: MaestroWebpackPluginOptions = {
        processName: 'webpack',
        orckitConfig: './orckit.yaml',
        waitFor: ['api'],
        reportProgress: true,
      };

      expect(options.processName).toBe('webpack');
      expect(options.orckitConfig).toBe('./orckit.yaml');
      expect(options.waitFor).toEqual(['api']);
      expect(options.reportProgress).toBe(true);
    });

    it('should allow minimal options', () => {
      const options: MaestroWebpackPluginOptions = {
        processName: 'webpack',
      };

      expect(options.processName).toBe('webpack');
    });
  });
});
