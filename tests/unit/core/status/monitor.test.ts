import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StatusMonitor } from '../../../../src/core/status/monitor.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

// Mock promisify
vi.mock('node:util', () => ({
  promisify: vi.fn((fn) => fn),
}));

describe('Status Monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default options', () => {
      const monitor = new StatusMonitor();

      expect(monitor).toBeDefined();
    });

    it('should accept custom options', () => {
      const monitor = new StatusMonitor({
        updateInterval: 2000,
        trackResources: false,
        trackBuildMetrics: false,
      });

      expect(monitor).toBeDefined();
    });
  });

  describe('registerProcess', () => {
    it('should register a process', () => {
      const monitor = new StatusMonitor();

      monitor.registerProcess('api', 'backend', 12345);

      const snapshot = monitor.getSnapshot();
      expect(snapshot.processes.size).toBe(1);

      const process = snapshot.processes.get('api');
      expect(process).toEqual({
        name: 'api',
        status: 'pending',
        category: 'backend',
        pid: 12345,
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 0,
        },
      });
    });

    it('should register process without PID', () => {
      const monitor = new StatusMonitor();

      monitor.registerProcess('api', 'backend');

      const snapshot = monitor.getSnapshot();
      const process = snapshot.processes.get('api');
      expect(process?.pid).toBeUndefined();
    });
  });

  describe('updateProcessStatus', () => {
    it('should update process status', () => {
      const monitor = new StatusMonitor();
      monitor.registerProcess('api', 'backend');

      monitor.updateProcessStatus('api', 'running');

      const snapshot = monitor.getSnapshot();
      const process = snapshot.processes.get('api');
      expect(process?.status).toBe('running');
    });

    it('should set lastStartTime when status becomes running', () => {
      const monitor = new StatusMonitor();
      monitor.registerProcess('api', 'backend');

      monitor.updateProcessStatus('api', 'running');

      const snapshot = monitor.getSnapshot();
      const process = snapshot.processes.get('api');
      expect(process?.lastStartTime).toBeDefined();
    });

    it('should emit snapshot event on status update', () => {
      const monitor = new StatusMonitor();
      monitor.registerProcess('api', 'backend');

      const snapshotListener = vi.fn();
      monitor.on('snapshot', snapshotListener);

      monitor.updateProcessStatus('api', 'running');

      expect(snapshotListener).toHaveBeenCalled();
    });

    it('should do nothing if process not found', () => {
      const monitor = new StatusMonitor();

      monitor.updateProcessStatus('nonexistent', 'running');

      const snapshot = monitor.getSnapshot();
      expect(snapshot.processes.size).toBe(0);
    });
  });

  describe('updateProcessPid', () => {
    it('should update process PID', () => {
      const monitor = new StatusMonitor();
      monitor.registerProcess('api', 'backend');

      monitor.updateProcessPid('api', 67890);

      const snapshot = monitor.getSnapshot();
      const process = snapshot.processes.get('api');
      expect(process?.pid).toBe(67890);
    });

    it('should do nothing if process not found', () => {
      const monitor = new StatusMonitor();

      monitor.updateProcessPid('nonexistent', 12345);

      const snapshot = monitor.getSnapshot();
      expect(snapshot.processes.size).toBe(0);
    });
  });

  describe('updateHealthCheckStatus', () => {
    it('should update health check status', () => {
      const monitor = new StatusMonitor();
      monitor.registerProcess('api', 'backend');

      monitor.updateHealthCheckStatus('api', 'passed');

      const snapshot = monitor.getSnapshot();
      const process = snapshot.processes.get('api');
      expect(process?.healthCheckStatus).toBe('passed');
    });

    it('should emit snapshot event on health check update', () => {
      const monitor = new StatusMonitor();
      monitor.registerProcess('api', 'backend');

      const snapshotListener = vi.fn();
      monitor.on('snapshot', snapshotListener);

      monitor.updateHealthCheckStatus('api', 'checking');

      expect(snapshotListener).toHaveBeenCalled();
    });

    it('should do nothing if process not found', () => {
      const monitor = new StatusMonitor();

      monitor.updateHealthCheckStatus('nonexistent', 'passed');

      const snapshot = monitor.getSnapshot();
      expect(snapshot.processes.size).toBe(0);
    });
  });

  describe('incrementRestartCount', () => {
    it('should increment restart count', () => {
      const monitor = new StatusMonitor();
      monitor.registerProcess('api', 'backend');

      monitor.incrementRestartCount('api');

      const snapshot = monitor.getSnapshot();
      const process = snapshot.processes.get('api');
      expect(process?.restartCount).toBe(1);

      monitor.incrementRestartCount('api');

      const snapshot2 = monitor.getSnapshot();
      const process2 = snapshot2.processes.get('api');
      expect(process2?.restartCount).toBe(2);
    });

    it('should do nothing if process not found', () => {
      const monitor = new StatusMonitor();

      monitor.incrementRestartCount('nonexistent');

      const snapshot = monitor.getSnapshot();
      expect(snapshot.processes.size).toBe(0);
    });
  });

  describe('updateBuildMetrics', () => {
    it('should update build metrics', () => {
      const monitor = new StatusMonitor();
      monitor.registerProcess('web', 'frontend');

      monitor.updateBuildMetrics('web', {
        progress: 50,
        errors: 2,
        warnings: 5,
      });

      const snapshot = monitor.getSnapshot();
      const process = snapshot.processes.get('web');
      expect(process?.buildMetrics).toEqual({
        progress: 50,
        errors: 2,
        warnings: 5,
      });
    });

    it('should merge build metrics', () => {
      const monitor = new StatusMonitor();
      monitor.registerProcess('web', 'frontend');

      monitor.updateBuildMetrics('web', {
        errors: 1,
        warnings: 3,
      });

      monitor.updateBuildMetrics('web', {
        progress: 75,
      });

      const snapshot = monitor.getSnapshot();
      const process = snapshot.processes.get('web');
      expect(process?.buildMetrics).toEqual({
        progress: 75,
        errors: 1,
        warnings: 3,
      });
    });

    it('should set lastBuildTime when progress reaches 100', () => {
      const monitor = new StatusMonitor();
      monitor.registerProcess('web', 'frontend');

      monitor.updateBuildMetrics('web', {
        progress: 100,
        errors: 0,
        warnings: 0,
      });

      const snapshot = monitor.getSnapshot();
      const process = snapshot.processes.get('web');
      expect(process?.buildMetrics?.lastBuildTime).toBeDefined();
    });

    it('should emit snapshot event on metrics update', () => {
      const monitor = new StatusMonitor();
      monitor.registerProcess('web', 'frontend');

      const snapshotListener = vi.fn();
      monitor.on('snapshot', snapshotListener);

      monitor.updateBuildMetrics('web', { progress: 25 });

      expect(snapshotListener).toHaveBeenCalled();
    });

    it('should do nothing if process not found', () => {
      const monitor = new StatusMonitor();

      monitor.updateBuildMetrics('nonexistent', { progress: 50 });

      const snapshot = monitor.getSnapshot();
      expect(snapshot.processes.size).toBe(0);
    });
  });

  describe('start and stop', () => {
    it('should start monitoring', () => {
      const monitor = new StatusMonitor({ updateInterval: 1000 });

      monitor.start();

      expect(monitor).toBeDefined();
    });

    it('should stop monitoring', () => {
      const monitor = new StatusMonitor({ updateInterval: 1000 });

      monitor.start();
      monitor.stop();

      expect(monitor).toBeDefined();
    });

    it('should not start if already running', () => {
      const monitor = new StatusMonitor({ updateInterval: 1000 });

      monitor.start();
      monitor.start(); // Should not throw

      expect(monitor).toBeDefined();
    });

    it('should not stop if not running', () => {
      const monitor = new StatusMonitor();

      monitor.stop(); // Should not throw

      expect(monitor).toBeDefined();
    });
  });

  describe('getSnapshot', () => {
    it('should return snapshot with processes', () => {
      const monitor = new StatusMonitor();

      monitor.registerProcess('api', 'backend');
      monitor.registerProcess('web', 'frontend');
      monitor.updateProcessStatus('api', 'running');
      monitor.updateProcessStatus('web', 'building');

      const snapshot = monitor.getSnapshot();

      expect(snapshot.processes.size).toBe(2);
      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.summary).toEqual({
        total: 2,
        running: 1,
        building: 1,
        failed: 0,
        stopped: 0,
      });
    });

    it('should calculate summary correctly', () => {
      const monitor = new StatusMonitor();

      monitor.registerProcess('api', 'backend');
      monitor.registerProcess('web', 'frontend');
      monitor.registerProcess('db', 'infrastructure');
      monitor.registerProcess('cache', 'infrastructure');

      monitor.updateProcessStatus('api', 'running');
      monitor.updateProcessStatus('web', 'building');
      monitor.updateProcessStatus('db', 'failed');
      monitor.updateProcessStatus('cache', 'stopped');

      const snapshot = monitor.getSnapshot();

      expect(snapshot.summary).toEqual({
        total: 4,
        running: 1,
        building: 1,
        failed: 1,
        stopped: 1,
      });
    });

    it('should return empty snapshot when no processes', () => {
      const monitor = new StatusMonitor();

      const snapshot = monitor.getSnapshot();

      expect(snapshot.processes.size).toBe(0);
      expect(snapshot.summary).toEqual({
        total: 0,
        running: 0,
        building: 0,
        failed: 0,
        stopped: 0,
      });
    });
  });

  describe('unregisterProcess', () => {
    it('should remove process from monitoring', () => {
      const monitor = new StatusMonitor();

      monitor.registerProcess('api', 'backend');
      monitor.registerProcess('web', 'frontend');

      monitor.unregisterProcess('api');

      const snapshot = monitor.getSnapshot();
      expect(snapshot.processes.size).toBe(1);
      expect(snapshot.processes.has('api')).toBe(false);
      expect(snapshot.processes.has('web')).toBe(true);
    });

    it('should emit snapshot event on unregister', () => {
      const monitor = new StatusMonitor();
      monitor.registerProcess('api', 'backend');

      const snapshotListener = vi.fn();
      monitor.on('snapshot', snapshotListener);

      monitor.unregisterProcess('api');

      expect(snapshotListener).toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should remove all processes', () => {
      const monitor = new StatusMonitor();

      monitor.registerProcess('api', 'backend');
      monitor.registerProcess('web', 'frontend');
      monitor.registerProcess('db', 'infrastructure');

      monitor.clear();

      const snapshot = monitor.getSnapshot();
      expect(snapshot.processes.size).toBe(0);
    });

    it('should emit snapshot event on clear', () => {
      const monitor = new StatusMonitor();
      monitor.registerProcess('api', 'backend');

      const snapshotListener = vi.fn();
      monitor.on('snapshot', snapshotListener);

      monitor.clear();

      expect(snapshotListener).toHaveBeenCalled();
    });
  });
});
