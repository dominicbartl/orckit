import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orckit } from '../../../src/core/orckit.js';
import type { OrckitConfig } from '../../../src/types/index.js';

// Mock all dependencies
vi.mock('../../../src/core/config/parser.js', () => ({
  parseConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock('../../../src/core/dependency/resolver.js', () => ({
  resolveDependencies: vi.fn(),
}));

describe('Orckit', () => {
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

      vi.mocked(parseConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);

      const orckit = new Orckit({
        configPath: '/path/to/config.yml',
      });

      expect(parseConfig).toHaveBeenCalledWith('/path/to/config.yml');
      expect(resolveDependencies).toHaveBeenCalledWith(mockConfig);
      expect(orckit.getProcessNames()).toEqual(['api', 'web']);
    });

    it('should validate config object', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);

      const orckit = new Orckit({
        config: mockConfig,
      });

      expect(validateConfig).toHaveBeenCalledWith(mockConfig);
      expect(orckit.getConfig()).toEqual(mockConfig);
    });

    it('should throw error if neither configPath nor config provided', () => {
      expect(() => new Orckit({})).toThrow('Either configPath or config must be provided');
    });

    it('should initialize all processes as pending', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);

      const orckit = new Orckit({ config: mockConfig });

      const statuses = orckit.getStatus() as Map<string, string>;
      expect(statuses.get('api')).toBe('pending');
      expect(statuses.get('web')).toBe('pending');
    });
  });

  describe('start', () => {
    it('should start all processes in order', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);

      const orckit = new Orckit({ config: mockConfig });

      await orckit.start();

      expect(orckit.getStatus('api')).toBe('running');
      expect(orckit.getStatus('web')).toBe('running');
    });

    it('should start specific processes only', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);

      const orckit = new Orckit({ config: mockConfig });

      await orckit.start(['api']);

      expect(orckit.getStatus('api')).toBe('running');
      expect(orckit.getStatus('web')).toBe('pending');
    });

    it('should emit process:starting event', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      const startingListener = vi.fn();
      orckit.on('process:starting', startingListener);

      await orckit.start();

      expect(startingListener).toHaveBeenCalledWith({
        processName: 'api',
        timestamp: expect.any(Date),
      });
    });

    it('should emit process:ready event', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      const readyListener = vi.fn();
      orckit.on('process:ready', readyListener);

      await orckit.start();

      expect(readyListener).toHaveBeenCalledWith({
        processName: 'api',
        timestamp: expect.any(Date),
        duration: 100,
      });
    });

    it('should emit all:ready event after all processes start', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);

      const orckit = new Orckit({ config: mockConfig });

      const allReadyListener = vi.fn();
      orckit.on('all:ready', allReadyListener);

      await orckit.start();

      expect(allReadyListener).toHaveBeenCalled();
    });

    it('should throw error if process not found', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      await expect(orckit.start(['nonexistent'])).rejects.toThrow(
        "Process 'nonexistent' not found in configuration"
      );
    });
  });

  describe('stop', () => {
    it('should stop all running processes in reverse order', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);

      const orckit = new Orckit({ config: mockConfig });

      await orckit.start();
      await orckit.stop();

      expect(orckit.getStatus('api')).toBe('stopped');
      expect(orckit.getStatus('web')).toBe('stopped');
    });

    it('should stop specific processes only', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);

      const orckit = new Orckit({ config: mockConfig });

      await orckit.start();
      await orckit.stop(['api']);

      expect(orckit.getStatus('api')).toBe('stopped');
      expect(orckit.getStatus('web')).toBe('running');
    });

    it('should emit process:stopped event', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      await orckit.start();

      const stoppedListener = vi.fn();
      orckit.on('process:stopped', stoppedListener);

      await orckit.stop();

      expect(stoppedListener).toHaveBeenCalledWith({
        processName: 'api',
        timestamp: expect.any(Date),
      });
    });

    it('should not emit stopped event for non-running processes', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      const stoppedListener = vi.fn();
      orckit.on('process:stopped', stoppedListener);

      await orckit.stop(); // Process is pending, not running

      expect(stoppedListener).not.toHaveBeenCalled();
    });
  });

  describe('restart', () => {
    it('should stop and start processes', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      await orckit.start();
      await orckit.restart(['api']);

      expect(orckit.getStatus('api')).toBe('running');
    });

    it('should emit stop and start events', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      const stoppedListener = vi.fn();
      const startingListener = vi.fn();

      orckit.on('process:stopped', stoppedListener);
      orckit.on('process:starting', startingListener);

      await orckit.start();
      await orckit.restart(['api']);

      expect(stoppedListener).toHaveBeenCalled();
      expect(startingListener).toHaveBeenCalledTimes(2); // Once for start, once for restart
    });
  });

  describe('getStatus', () => {
    it('should return status for specific process', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      expect(orckit.getStatus('api')).toBe('pending');

      await orckit.start();

      expect(orckit.getStatus('api')).toBe('running');
    });

    it('should return pending for non-existent process', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      expect(orckit.getStatus('nonexistent')).toBe('pending');
    });

    it('should return Map of all statuses when no process name provided', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);

      const orckit = new Orckit({ config: mockConfig });

      const statuses = orckit.getStatus() as Map<string, string>;

      expect(statuses).toBeInstanceOf(Map);
      expect(statuses.size).toBe(2);
      expect(statuses.get('api')).toBe('pending');
      expect(statuses.get('web')).toBe('pending');
    });
  });

  describe('waitForReady', () => {
    it('should return true when process becomes ready', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      // Start process in background
      setTimeout(() => orckit.start(), 50);

      const ready = await orckit.waitForReady('api', { timeout: 5000 });

      expect(ready).toBe(true);
    });

    it('should return false when timeout expires', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      const ready = await orckit.waitForReady('api', { timeout: 200 });

      expect(ready).toBe(false);
    });

    it('should use default timeout of 30000ms', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      // Start process after a short delay
      setTimeout(() => orckit.start(), 50);

      const ready = await orckit.waitForReady('api');

      expect(ready).toBe(true);
    });
  });

  describe('addProcess', () => {
    it('should add a new process to configuration', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      orckit.addProcess('db', {
        category: 'infrastructure',
        command: 'docker run postgres',
      });

      const config = orckit.getConfig();
      expect(config.processes['db']).toBeDefined();
      expect(config.processes['db'].command).toBe('docker run postgres');
    });

    it('should initialize new process as pending', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      orckit.addProcess('db', {
        category: 'infrastructure',
        command: 'docker run postgres',
      });

      expect(orckit.getStatus('db')).toBe('pending');
    });
  });

  describe('removeProcess', () => {
    it('should stop and remove process', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      await orckit.start();
      await orckit.removeProcess('api');

      const config = orckit.getConfig();
      expect(config.processes['api']).toBeUndefined();

      const statuses = orckit.getStatus() as Map<string, string>;
      expect(statuses.has('api')).toBe(false);
    });

    it('should emit stopped event when removing running process', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api']);

      const orckit = new Orckit({ config: mockConfig });

      await orckit.start();

      const stoppedListener = vi.fn();
      orckit.on('process:stopped', stoppedListener);

      await orckit.removeProcess('api');

      expect(stoppedListener).toHaveBeenCalled();
    });
  });

  describe('getConfig', () => {
    it('should return the configuration', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);

      const orckit = new Orckit({ config: mockConfig });

      expect(orckit.getConfig()).toEqual(mockConfig);
    });
  });

  describe('getProcessNames', () => {
    it('should return process names in start order', async () => {
      const { validateConfig } = await import('../../../src/core/config/parser.js');
      const { resolveDependencies } = await import('../../../src/core/dependency/resolver.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'web']);

      const orckit = new Orckit({ config: mockConfig });

      expect(orckit.getProcessNames()).toEqual(['api', 'web']);
    });
  });
});
