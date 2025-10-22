import { describe, it, expect, vi, beforeEach } from 'vitest';
import { maestro } from '../../../src/plugins/vite.js';
import type { MaestroVitePluginOptions } from '../../../src/plugins/vite.js';

describe('Vite Plugin', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('maestro', () => {
    it('should create plugin with name', () => {
      const options: MaestroVitePluginOptions = {
        processName: 'vite',
      };

      const plugin = maestro(options);

      expect(plugin.name).toBe('orckit-vite-plugin');
    });

    it('should have configResolved hook', () => {
      const options: MaestroVitePluginOptions = {
        processName: 'vite',
      };

      const plugin = maestro(options);

      expect(plugin.configResolved).toBeDefined();
      expect(typeof plugin.configResolved).toBe('function');
    });

    it('should emit config:resolved event', () => {
      const options: MaestroVitePluginOptions = {
        processName: 'vite',
      };

      const plugin = maestro(options);
      plugin.configResolved();

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[ORCKIT_EVENT]');
      expect(output).toContain('config:resolved');
      expect(output).toContain('vite');
    });

    it('should have buildStart hook', () => {
      const options: MaestroVitePluginOptions = {
        processName: 'vite',
      };

      const plugin = maestro(options);

      expect(plugin.buildStart).toBeDefined();
      expect(typeof plugin.buildStart).toBe('function');
    });

    it('should emit build:start event', () => {
      const options: MaestroVitePluginOptions = {
        processName: 'vite',
      };

      const plugin = maestro(options);
      plugin.buildStart();

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[ORCKIT_EVENT]');
      expect(output).toContain('build:start');
      expect(output).toContain('vite');
    });

    it('should have buildEnd hook', () => {
      const options: MaestroVitePluginOptions = {
        processName: 'vite',
      };

      const plugin = maestro(options);

      expect(plugin.buildEnd).toBeDefined();
      expect(typeof plugin.buildEnd).toBe('function');
    });

    it('should emit build:complete event on success', () => {
      const options: MaestroVitePluginOptions = {
        processName: 'vite',
      };

      const plugin = maestro(options);
      plugin.buildStart();
      consoleLogSpy.mockClear();

      plugin.buildEnd();

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[ORCKIT_EVENT]');
      expect(output).toContain('build:complete');
      expect(output).toContain('"success":true');
    });

    it('should emit build:failed event on error', () => {
      const options: MaestroVitePluginOptions = {
        processName: 'vite',
      };

      const plugin = maestro(options);
      plugin.buildStart();
      consoleLogSpy.mockClear();

      const error = new Error('Build failed');
      plugin.buildEnd(error);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[ORCKIT_EVENT]');
      expect(output).toContain('build:failed');
      expect(output).toContain('Build failed');
    });

    it('should include duration in build events', () => {
      const options: MaestroVitePluginOptions = {
        processName: 'vite',
      };

      const plugin = maestro(options);
      plugin.buildStart();
      consoleLogSpy.mockClear();

      plugin.buildEnd();

      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('duration');
    });

    it('should have configureServer hook', () => {
      const options: MaestroVitePluginOptions = {
        processName: 'vite',
      };

      const plugin = maestro(options);

      expect(plugin.configureServer).toBeDefined();
      expect(typeof plugin.configureServer).toBe('function');
    });

    it('should emit server:ready event when server listening', () => {
      const options: MaestroVitePluginOptions = {
        processName: 'vite',
      };

      const plugin = maestro(options);

      // Mock vite server
      const mockServer = {
        httpServer: {
          once: vi.fn((event: string, callback: () => void) => {
            if (event === 'listening') {
              callback();
            }
          }),
          address: () => ({ port: 5173 }),
        },
      };

      plugin.configureServer(mockServer);

      expect(mockServer.httpServer.once).toHaveBeenCalledWith('listening', expect.any(Function));
      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('server:ready');
      expect(output).toContain('5173');
    });

    it('should handle server without httpServer', () => {
      const options: MaestroVitePluginOptions = {
        processName: 'vite',
      };

      const plugin = maestro(options);

      const mockServer = {
        httpServer: null,
      };

      expect(() => plugin.configureServer(mockServer)).not.toThrow();
    });

    it('should handle server with non-object address', () => {
      const options: MaestroVitePluginOptions = {
        processName: 'vite',
      };

      const plugin = maestro(options);

      const mockServer = {
        httpServer: {
          once: vi.fn((event: string, callback: () => void) => {
            if (event === 'listening') {
              callback();
            }
          }),
          address: () => 'some-string',
        },
      };

      plugin.configureServer(mockServer);

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('MaestroVitePluginOptions', () => {
    it('should allow valid options', () => {
      const options: MaestroVitePluginOptions = {
        processName: 'vite',
        configPath: './orckit.yaml',
        startDependencies: true,
      };

      expect(options.processName).toBe('vite');
      expect(options.configPath).toBe('./orckit.yaml');
      expect(options.startDependencies).toBe(true);
    });

    it('should allow minimal options', () => {
      const options: MaestroVitePluginOptions = {
        processName: 'vite',
      };

      expect(options.processName).toBe('vite');
    });
  });
});
