import { describe, it, expect, beforeEach } from 'vitest';
import { formatStatusSnapshot, formatCompactStatus } from '../../../../src/core/status/formatter.js';
import type { StatusSnapshot } from '../../../../src/core/status/monitor.js';

describe('Status Formatter', () => {
  let baseSnapshot: StatusSnapshot;

  beforeEach(() => {
    baseSnapshot = {
      timestamp: new Date('2024-01-01T12:00:00Z').getTime(),
      processes: new Map(),
      summary: {
        total: 0,
        running: 0,
        building: 0,
        failed: 0,
        stopped: 0,
      },
    };
  });

  describe('formatStatusSnapshot', () => {
    it('should format empty snapshot', () => {
      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('ORCKIT STATUS OVERVIEW');
      expect(output).toContain('0 running');
      expect(output).toContain('Last updated:');
    });

    it('should format snapshot with running process', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'running',
        category: 'backend',
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 0,
        },
      });
      baseSnapshot.summary = {
        total: 1,
        running: 1,
        building: 0,
        failed: 0,
        stopped: 0,
      };

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('api');
      expect(output).toContain('BACKEND');
      expect(output).toContain('1 running');
    });

    it('should format snapshot with multiple processes', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'running',
        category: 'backend',
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 0,
        },
      });
      baseSnapshot.processes.set('web', {
        name: 'web',
        status: 'building',
        category: 'frontend',
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 0,
          progress: 50,
        },
      });
      baseSnapshot.summary = {
        total: 2,
        running: 1,
        building: 1,
        failed: 0,
        stopped: 0,
      };

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('api');
      expect(output).toContain('web');
      expect(output).toContain('BACKEND');
      expect(output).toContain('FRONTEND');
      expect(output).toContain('1 running');
      expect(output).toContain('1 building');
    });

    it('should display process with PID', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'running',
        category: 'backend',
        pid: 12345,
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 0,
        },
      });
      baseSnapshot.summary.total = 1;
      baseSnapshot.summary.running = 1;

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('api');
    });

    it('should display process with resources', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'running',
        category: 'backend',
        pid: 12345,
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 0,
        },
        resources: {
          cpu: 25.5,
          memory: 512.3,
          uptime: 3665, // 1h 1m 5s
        },
      });
      baseSnapshot.summary.total = 1;
      baseSnapshot.summary.running = 1;

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('25.5%'); // CPU
      expect(output).toContain('512.3MB'); // Memory under 1024MB
      expect(output).toContain('1h 1m'); // Uptime formatted
    });

    it('should format memory in GB when over 1024MB', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'running',
        category: 'backend',
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 0,
        },
        resources: {
          cpu: 10,
          memory: 2048, // 2GB
          uptime: 60,
        },
      });
      baseSnapshot.summary.total = 1;
      baseSnapshot.summary.running = 1;

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('2.0GB');
    });

    it('should format uptime in seconds when under 60s', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'running',
        category: 'backend',
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 0,
        },
        resources: {
          cpu: 10,
          memory: 100,
          uptime: 45,
        },
      });
      baseSnapshot.summary.total = 1;
      baseSnapshot.summary.running = 1;

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('45s');
    });

    it('should format uptime in minutes when under 1h', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'running',
        category: 'backend',
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 0,
        },
        resources: {
          cpu: 10,
          memory: 100,
          uptime: 125, // 2m 5s
        },
      });
      baseSnapshot.summary.total = 1;
      baseSnapshot.summary.running = 1;

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('2m 5s');
    });

    it('should display build progress for building process', () => {
      baseSnapshot.processes.set('web', {
        name: 'web',
        status: 'building',
        category: 'frontend',
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 0,
          progress: 75,
        },
      });
      baseSnapshot.summary.total = 1;
      baseSnapshot.summary.building = 1;

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('75%');
    });

    it('should display errors and warnings when present', () => {
      baseSnapshot.processes.set('web', {
        name: 'web',
        status: 'running',
        category: 'frontend',
        restartCount: 0,
        buildMetrics: {
          errors: 3,
          warnings: 5,
        },
      });
      baseSnapshot.summary.total = 1;
      baseSnapshot.summary.running = 1;

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('3E');
      expect(output).toContain('5W');
    });

    it('should display only errors when no warnings', () => {
      baseSnapshot.processes.set('web', {
        name: 'web',
        status: 'failed',
        category: 'frontend',
        restartCount: 0,
        buildMetrics: {
          errors: 2,
          warnings: 0,
        },
      });
      baseSnapshot.summary.total = 1;
      baseSnapshot.summary.failed = 1;

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('2E');
      expect(output).not.toContain('0W');
    });

    it('should display only warnings when no errors', () => {
      baseSnapshot.processes.set('web', {
        name: 'web',
        status: 'running',
        category: 'frontend',
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 3,
        },
      });
      baseSnapshot.summary.total = 1;
      baseSnapshot.summary.running = 1;

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('3W');
      expect(output).not.toContain('0E');
    });

    it('should display restart count when greater than 0', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'running',
        category: 'backend',
        restartCount: 3,
        buildMetrics: {
          errors: 0,
          warnings: 0,
        },
      });
      baseSnapshot.summary.total = 1;
      baseSnapshot.summary.running = 1;

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('↻3');
    });

    it('should not display restart count when 0', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'running',
        category: 'backend',
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 0,
        },
      });
      baseSnapshot.summary.total = 1;
      baseSnapshot.summary.running = 1;

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).not.toContain('↻0');
    });

    it('should display health check status - pending', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'starting',
        category: 'backend',
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 0,
        },
        healthCheckStatus: 'pending',
      });
      baseSnapshot.summary.total = 1;

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('⧗');
    });

    it('should display health check status - checking', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'starting',
        category: 'backend',
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 0,
        },
        healthCheckStatus: 'checking',
      });
      baseSnapshot.summary.total = 1;

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('⟳');
    });

    it('should display health check status - passed', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'running',
        category: 'backend',
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 0,
        },
        healthCheckStatus: 'passed',
      });
      baseSnapshot.summary.total = 1;
      baseSnapshot.summary.running = 1;

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('✓');
    });

    it('should display health check status - failed', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'failed',
        category: 'backend',
        restartCount: 0,
        buildMetrics: {
          errors: 0,
          warnings: 0,
        },
        healthCheckStatus: 'failed',
      });
      baseSnapshot.summary.total = 1;
      baseSnapshot.summary.failed = 1;

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('✗');
    });

    it('should group processes by category', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'running',
        category: 'backend',
        restartCount: 0,
        buildMetrics: { errors: 0, warnings: 0 },
      });
      baseSnapshot.processes.set('worker', {
        name: 'worker',
        status: 'running',
        category: 'backend',
        restartCount: 0,
        buildMetrics: { errors: 0, warnings: 0 },
      });
      baseSnapshot.processes.set('web', {
        name: 'web',
        status: 'building',
        category: 'frontend',
        restartCount: 0,
        buildMetrics: { errors: 0, warnings: 0 },
      });
      baseSnapshot.summary = {
        total: 3,
        running: 2,
        building: 1,
        failed: 0,
        stopped: 0,
      };

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('BACKEND');
      expect(output).toContain('FRONTEND');

      // Check that backend processes appear together
      const backendIndex = output.indexOf('BACKEND');
      const frontendIndex = output.indexOf('FRONTEND');
      const apiIndex = output.indexOf('api');
      const workerIndex = output.indexOf('worker');
      const webIndex = output.indexOf('web');

      expect(backendIndex).toBeLessThan(apiIndex);
      expect(backendIndex).toBeLessThan(workerIndex);
      expect(frontendIndex).toBeLessThan(webIndex);
    });

    it('should display all process statuses', () => {
      baseSnapshot.processes.set('running', {
        name: 'running',
        status: 'running',
        category: 'test',
        restartCount: 0,
        buildMetrics: { errors: 0, warnings: 0 },
      });
      baseSnapshot.processes.set('building', {
        name: 'building',
        status: 'building',
        category: 'test',
        restartCount: 0,
        buildMetrics: { errors: 0, warnings: 0 },
      });
      baseSnapshot.processes.set('starting', {
        name: 'starting',
        status: 'starting',
        category: 'test',
        restartCount: 0,
        buildMetrics: { errors: 0, warnings: 0 },
      });
      baseSnapshot.processes.set('failed', {
        name: 'failed',
        status: 'failed',
        category: 'test',
        restartCount: 0,
        buildMetrics: { errors: 0, warnings: 0 },
      });
      baseSnapshot.processes.set('stopped', {
        name: 'stopped',
        status: 'stopped',
        category: 'test',
        restartCount: 0,
        buildMetrics: { errors: 0, warnings: 0 },
      });
      baseSnapshot.processes.set('pending', {
        name: 'pending',
        status: 'pending',
        category: 'test',
        restartCount: 0,
        buildMetrics: { errors: 0, warnings: 0 },
      });

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('running');
      expect(output).toContain('building');
      expect(output).toContain('starting');
      expect(output).toContain('failed');
      expect(output).toContain('stopped');
      expect(output).toContain('pending');
    });

    it('should show stopped processes in summary', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'stopped',
        category: 'backend',
        restartCount: 0,
        buildMetrics: { errors: 0, warnings: 0 },
      });
      baseSnapshot.summary = {
        total: 1,
        running: 0,
        building: 0,
        failed: 0,
        stopped: 1,
      };

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('1 stopped');
    });

    it('should show failed processes in summary', () => {
      baseSnapshot.processes.set('api', {
        name: 'api',
        status: 'failed',
        category: 'backend',
        restartCount: 0,
        buildMetrics: { errors: 1, warnings: 0 },
      });
      baseSnapshot.summary = {
        total: 1,
        running: 0,
        building: 0,
        failed: 1,
        stopped: 0,
      };

      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('1 failed');
    });

    it('should format timestamp correctly', () => {
      const output = formatStatusSnapshot(baseSnapshot);

      expect(output).toContain('Last updated:');
      expect(output).toMatch(/\d{1,2}:\d{2}:\d{2}/); // Time format
    });
  });

  describe('formatCompactStatus', () => {
    it('should format compact status with only running processes', () => {
      baseSnapshot.summary = {
        total: 3,
        running: 3,
        building: 0,
        failed: 0,
        stopped: 0,
      };

      const output = formatCompactStatus(baseSnapshot);

      expect(output).toContain('✓ 3');
      expect(output).not.toContain('⟳');
      expect(output).not.toContain('✗');
    });

    it('should format compact status with running and building', () => {
      baseSnapshot.summary = {
        total: 4,
        running: 2,
        building: 2,
        failed: 0,
        stopped: 0,
      };

      const output = formatCompactStatus(baseSnapshot);

      expect(output).toContain('✓ 2');
      expect(output).toContain('⟳ 2');
    });

    it('should format compact status with failed processes', () => {
      baseSnapshot.summary = {
        total: 3,
        running: 1,
        building: 0,
        failed: 2,
        stopped: 0,
      };

      const output = formatCompactStatus(baseSnapshot);

      expect(output).toContain('✓ 1');
      expect(output).toContain('✗ 2');
    });

    it('should format compact status with all states', () => {
      baseSnapshot.summary = {
        total: 6,
        running: 2,
        building: 2,
        failed: 2,
        stopped: 0,
      };

      const output = formatCompactStatus(baseSnapshot);

      expect(output).toContain('✓ 2');
      expect(output).toContain('⟳ 2');
      expect(output).toContain('✗ 2');
    });

    it('should not show building when 0', () => {
      baseSnapshot.summary = {
        total: 2,
        running: 2,
        building: 0,
        failed: 0,
        stopped: 0,
      };

      const output = formatCompactStatus(baseSnapshot);

      expect(output).not.toContain('⟳');
    });

    it('should not show failed when 0', () => {
      baseSnapshot.summary = {
        total: 2,
        running: 2,
        building: 0,
        failed: 0,
        stopped: 0,
      };

      const output = formatCompactStatus(baseSnapshot);

      expect(output).not.toContain('✗');
    });

    it('should handle empty snapshot', () => {
      baseSnapshot.summary = {
        total: 0,
        running: 0,
        building: 0,
        failed: 0,
        stopped: 0,
      };

      const output = formatCompactStatus(baseSnapshot);

      expect(output).toContain('✓ 0');
    });
  });
});
