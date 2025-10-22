import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { Orchestrator } from '../../../src/core/orchestrator.js';
import type { OrckitConfig } from '../../../src/types/index.js';

// Mock all dependencies
vi.mock('../../../src/core/config/parser.js', () => ({
  parseConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock('../../../src/core/dependency/resolver.js', () => ({
  resolveDependencies: vi.fn(),
  groupIntoWaves: vi.fn(),
}));

vi.mock('../../../src/core/status/monitor.js', () => ({
  StatusMonitor: vi.fn(),
}));

vi.mock('../../../src/core/status/formatter.js', () => ({
  formatStatusSnapshot: vi.fn(),
}));

vi.mock('../../../src/core/tmux/manager.js', () => ({
  TmuxManager: vi.fn(),
}));

vi.mock('../../../src/core/boot/logger.js', () => ({
  BootLogger: vi.fn(),
}));

vi.mock('../../../src/core/preflight/runner.js', () => ({
  runPreflight: vi.fn(),
}));

vi.mock('../../../src/runners/factory.js', () => ({
  createRunner: vi.fn(),
}));

describe('Orchestrator', () => {
  let mockConfig: OrckitConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      project: 'test-project',
      processes: {
        api: {
          category: 'backend',
          command: 'npm start',
        },
        web: {
          category: 'frontend',
          command: 'npm run dev',
        },
      },
    };
  });

  describe('constructor', () => {
    it('should load config from file path', async () => {
      const { parseConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');
      const { BootLogger } = await import('../../../src/core/boot/logger.js');

      vi.mocked(parseConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);
      vi.mocked(BootLogger).mockImplementation(() => ({} as any));

      const orchestrator = new Orchestrator({
        configPath: '/path/to/config.yml',
        enableStatusMonitor: false,
        enableTmux: false,
      });

      expect(parseConfig).toHaveBeenCalledWith('/path/to/config.yml');
      expect(resolveDependencies).toHaveBeenCalledWith(mockConfig);
    });

    it('should validate config object', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');
      const { BootLogger } = await import('../../../src/core/boot/logger.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);
      vi.mocked(BootLogger).mockImplementation(() => ({} as any));

      const orchestrator = new Orchestrator({
        config: mockConfig,
        enableStatusMonitor: false,
        enableTmux: false,
      });

      expect(validateConfig).toHaveBeenCalledWith(mockConfig);
    });

    it('should throw error if neither configPath nor config provided', () => {
      expect(() => new Orchestrator({})).toThrow('Either configPath or config must be provided');
    });
  });

  describe('start', () => {
    it('should run preflight checks', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../../src/core/boot/logger.js');
      const { createRunner } = await import('../../../src/runners/factory.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);
      vi.mocked(groupIntoWaves).mockReturnValue([['api'], ['web']]);
      vi.mocked(runPreflight).mockResolvedValue([
        { name: 'tmux', passed: true, duration: 10 },
        { name: 'node_version', passed: true, duration: 5 },
      ]);

      const mockRunner = new EventEmitter() as any;
      mockRunner.start = vi.fn().mockResolvedValue(undefined);
      mockRunner.pid = 12345;
      mockRunner.status = 'running';
      vi.mocked(createRunner).mockReturnValue(mockRunner);

      const mockBootLogger = {
        printHeader: vi.fn(),
        printPhaseHeader: vi.fn(),
        printPreflightCheck: vi.fn(),
        printProcessStarting: vi.fn(),
        printProcessReady: vi.fn(),
        printCompletion: vi.fn(),
      };
      vi.mocked(BootLogger).mockImplementation(() => mockBootLogger as any);

      const orchestrator = new Orchestrator({
        config: mockConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await orchestrator.start();

      expect(runPreflight).toHaveBeenCalledWith(mockConfig);
      expect(mockBootLogger.printPreflightCheck).toHaveBeenCalledTimes(2);
    });

    it('should throw error if preflight checks fail', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');
      const { runPreflight } = await import('../../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../../src/core/boot/logger.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);
      vi.mocked(runPreflight).mockResolvedValue([
        { name: 'tmux', passed: false, duration: 10 },
        { name: 'node_version', passed: true, duration: 5 },
      ]);

      const mockBootLogger = {
        printHeader: vi.fn(),
        printPhaseHeader: vi.fn(),
        printPreflightCheck: vi.fn(),
      };
      vi.mocked(BootLogger).mockImplementation(() => mockBootLogger as any);

      const orchestrator = new Orchestrator({
        config: mockConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await expect(orchestrator.start()).rejects.toThrow('Preflight checks failed: tmux');
    });

    it('should emit all:ready event after starting', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../../src/core/boot/logger.js');
      const { createRunner } = await import('../../../src/runners/factory.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);
      vi.mocked(groupIntoWaves).mockReturnValue([['api']]);
      vi.mocked(runPreflight).mockResolvedValue([{ name: 'tmux', passed: true, duration: 10 }]);

      const mockRunner = new EventEmitter() as any;
      mockRunner.start = vi.fn().mockResolvedValue(undefined);
      mockRunner.pid = 12345;
      mockRunner.status = 'running';
      vi.mocked(createRunner).mockReturnValue(mockRunner);

      const mockBootLogger = {
        printHeader: vi.fn(),
        printPhaseHeader: vi.fn(),
        printPreflightCheck: vi.fn(),
        printProcessStarting: vi.fn(),
        printCompletion: vi.fn(),
      };
      vi.mocked(BootLogger).mockImplementation(() => mockBootLogger as any);

      const orchestrator = new Orchestrator({
        config: mockConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      const readyListener = vi.fn();
      orchestrator.on('all:ready', readyListener);

      await orchestrator.start();

      expect(readyListener).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should stop all processes', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../../src/core/boot/logger.js');
      const { createRunner } = await import('../../../src/runners/factory.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);
      vi.mocked(groupIntoWaves).mockReturnValue([['api'], ['web']]);
      vi.mocked(runPreflight).mockResolvedValue([{ name: 'tmux', passed: true, duration: 10 }]);

      const mockRunner = new EventEmitter() as any;
      mockRunner.start = vi.fn().mockResolvedValue(undefined);
      mockRunner.stop = vi.fn().mockResolvedValue(undefined);
      mockRunner.pid = 12345;
      mockRunner.status = 'running';
      vi.mocked(createRunner).mockReturnValue(mockRunner);

      const mockBootLogger = {
        printHeader: vi.fn(),
        printPhaseHeader: vi.fn(),
        printPreflightCheck: vi.fn(),
        printProcessStarting: vi.fn(),
        printCompletion: vi.fn(),
      };
      vi.mocked(BootLogger).mockImplementation(() => mockBootLogger as any);

      const orchestrator = new Orchestrator({
        config: mockConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await orchestrator.start();
      await orchestrator.stop();

      expect(mockRunner.stop).toHaveBeenCalledTimes(2);
    });
  });

  describe('getStatus', () => {
    it('should return status for specific process', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../../src/core/boot/logger.js');
      const { createRunner } = await import('../../../src/runners/factory.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);
      vi.mocked(groupIntoWaves).mockReturnValue([['api']]);
      vi.mocked(runPreflight).mockResolvedValue([{ name: 'tmux', passed: true, duration: 10 }]);

      const mockRunner = new EventEmitter() as any;
      mockRunner.start = vi.fn().mockResolvedValue(undefined);
      mockRunner.pid = 12345;
      mockRunner.status = 'running';
      vi.mocked(createRunner).mockReturnValue(mockRunner);

      const mockBootLogger = {
        printHeader: vi.fn(),
        printPhaseHeader: vi.fn(),
        printPreflightCheck: vi.fn(),
        printProcessStarting: vi.fn(),
        printCompletion: vi.fn(),
      };
      vi.mocked(BootLogger).mockImplementation(() => mockBootLogger as any);

      const orchestrator = new Orchestrator({
        config: mockConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await orchestrator.start();

      const status = orchestrator.getStatus('api');
      expect(status).toBe('running');
    });
  });

  describe('getConfig', () => {
    it('should return configuration', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');
      const { BootLogger } = await import('../../../src/core/boot/logger.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);
      vi.mocked(BootLogger).mockImplementation(() => ({} as any));

      const orchestrator = new Orchestrator({
        config: mockConfig,
        enableStatusMonitor: false,
        enableTmux: false,
      });

      expect(orchestrator.getConfig()).toEqual(mockConfig);
    });
  });

  describe('getProcessNames', () => {
    it('should return process names in start order', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');
      const { BootLogger } = await import('../../../src/core/boot/logger.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);
      vi.mocked(BootLogger).mockImplementation(() => ({} as any));

      const orchestrator = new Orchestrator({
        config: mockConfig,
        enableStatusMonitor: false,
        enableTmux: false,
      });

      expect(orchestrator.getProcessNames()).toEqual(['api', 'web']);
    });
  });

  describe('attach', () => {
    it('should throw error if tmux not enabled', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');
      const { BootLogger } = await import('../../../src/core/boot/logger.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);
      vi.mocked(BootLogger).mockImplementation(() => ({} as any));

      const orchestrator = new Orchestrator({
        config: mockConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await expect(orchestrator.attach()).rejects.toThrow('tmux integration is not enabled');
    });
  });
});
