/**
 * Tests for the Orckit main orchestrator class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Orckit } from '../../../src/core/orckit.js';
import type { OrckitConfig } from '../../../src/types/index.js';

// Mock dependencies
vi.mock('../../../src/core/preflight/runner.js', () => ({
  runPreflight: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/core/boot/logger.js', () => ({
  BootLogger: vi.fn().mockImplementation(() => ({
    printHeader: vi.fn(),
    printPhaseHeader: vi.fn(),
    printPreflightCheck: vi.fn(),
    printProcessStarting: vi.fn(),
    printProcessReady: vi.fn(),
    printCompletion: vi.fn(),
  })),
}));

vi.mock('../../../src/runners/factory.js', () => ({
  createRunner: vi.fn().mockImplementation((name: string) => {
    const EventEmitter = require('events');
    const runner = new EventEmitter();
    runner.name = name;
    runner.status = 'pending';
    runner.pid = Math.floor(Math.random() * 90000) + 10000;
    runner.start = vi.fn().mockImplementation(async () => {
      runner.status = 'running';
      runner.emit('status', 'running');
      runner.emit('ready');
    });
    runner.stop = vi.fn().mockImplementation(async () => {
      runner.status = 'stopped';
      runner.emit('status', 'stopped');
    });
    runner.restart = vi.fn().mockImplementation(async () => {
      runner.status = 'running';
      runner.emit('restarting', 1);
      runner.emit('status', 'running');
      runner.emit('ready');
    });
    return runner;
  }),
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
          dependencies: ['api'],
        },
      },
    };
  });

  describe('constructor', () => {
    it('should accept a config object', () => {
      const orckit = new Orckit({ config: mockConfig, skipPreflight: true });

      expect(orckit.getConfig().project).toBe('test-project');
      expect(orckit.getProcessNames()).toContain('api');
      expect(orckit.getProcessNames()).toContain('web');
    });

    it('should throw error if neither configPath nor config provided', () => {
      expect(() => new Orckit({} as any)).toThrow();
    });

    it('should resolve dependencies correctly', () => {
      const orckit = new Orckit({ config: mockConfig, skipPreflight: true });

      const names = orckit.getProcessNames();
      // api should come before web (web depends on api)
      expect(names.indexOf('api')).toBeLessThan(names.indexOf('web'));
    });
  });

  describe('start', () => {
    it('should start all processes', async () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      await orckit.start();

      expect(orckit.getStatus('api')).toBe('running');
      expect(orckit.getStatus('web')).toBe('running');
    });

    it('should start specific processes only', async () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      await orckit.start(['api']);

      expect(orckit.getStatus('api')).toBe('running');
      // web not started
      expect(orckit.getStatus('web')).toBe('pending');
    });

    it('should include dependencies when starting specific process', async () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      // Request to start web, should also start api (dependency)
      await orckit.start(['web']);

      expect(orckit.getStatus('api')).toBe('running');
      expect(orckit.getStatus('web')).toBe('running');
    });

    it('should emit process:starting event', async () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const startingEvents: string[] = [];
      orckit.on('process:starting', (event) => {
        startingEvents.push(event.processName);
      });

      await orckit.start();

      expect(startingEvents).toContain('api');
      expect(startingEvents).toContain('web');
    });

    it('should emit all:ready event after all processes start', async () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const allReadyListener = vi.fn();
      orckit.on('all:ready', allReadyListener);

      await orckit.start();

      expect(allReadyListener).toHaveBeenCalled();
    });

    it('should throw error for unknown process', async () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      await expect(orckit.start(['nonexistent'])).rejects.toThrow();
    });
  });

  describe('stop', () => {
    it('should stop all running processes', async () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      await orckit.start();
      await orckit.stop();

      // After stop, statuses should be 'stopped'
      expect(orckit.getStatus('api')).toBe('stopped');
      expect(orckit.getStatus('web')).toBe('stopped');
    });

    it('should emit process:stopped event', async () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      await orckit.start();

      const stoppedEvents: string[] = [];
      orckit.on('process:stopped', (event) => {
        stoppedEvents.push(event.processName);
      });

      await orckit.stop();

      expect(stoppedEvents).toContain('api');
      expect(stoppedEvents).toContain('web');
    });
  });

  describe('restart', () => {
    it('should restart specified processes', async () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      await orckit.start();
      await orckit.restart(['api']);

      expect(orckit.getStatus('api')).toBe('running');
    });
  });

  describe('getStatus', () => {
    it('should return status for specific process', async () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      expect(orckit.getStatus('api')).toBe('pending');

      await orckit.start(['api']);

      expect(orckit.getStatus('api')).toBe('running');
    });

    it('should return Map of all statuses when no process name provided', async () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const statuses = orckit.getStatus() as Map<string, string>;

      expect(statuses).toBeInstanceOf(Map);
      expect(statuses.size).toBe(2);
      expect(statuses.get('api')).toBe('pending');
      expect(statuses.get('web')).toBe('pending');
    });
  });

  describe('getConfig', () => {
    it('should return the configuration', () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const config = orckit.getConfig();

      expect(config.project).toBe('test-project');
      expect(config.processes.api).toBeDefined();
      expect(config.processes.web).toBeDefined();
    });
  });

  describe('getProcessNames', () => {
    it('should return process names in dependency order', () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      const names = orckit.getProcessNames();

      expect(names).toHaveLength(2);
      // api before web (web depends on api)
      expect(names.indexOf('api')).toBeLessThan(names.indexOf('web'));
    });
  });

  describe('waitForReady', () => {
    it('should return true when process is running', async () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      await orckit.start(['api']);

      const ready = await orckit.waitForReady('api', { timeout: 1000 });

      expect(ready).toBe(true);
    });

    it('should return false when timeout expires', async () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      // Don't start the process
      const ready = await orckit.waitForReady('api', { timeout: 100 });

      expect(ready).toBe(false);
    });
  });

  describe('started property', () => {
    it('should be false initially', () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      expect(orckit.started).toBe(false);
    });

    it('should be true after start', async () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      await orckit.start();

      expect(orckit.started).toBe(true);
    });

    it('should be false after stop', async () => {
      const orckit = new Orckit({
        config: mockConfig,
        skipPreflight: true,
        enableIPC: false,
        enableStatusMonitor: false,
      });

      await orckit.start();
      await orckit.stop();

      expect(orckit.started).toBe(false);
    });
  });
});
