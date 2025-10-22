/**
 * Real-time status monitoring for overview pane
 */

import { EventEmitter } from 'node:events';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProcessStatus } from '@/types';

const execAsync = promisify(exec);

/**
 * Process resource usage
 */
export interface ProcessResourceUsage {
  cpu: number; // Percentage
  memory: number; // MB
  uptime: number; // Seconds
}

/**
 * Build metrics
 */
export interface BuildMetrics {
  progress?: number; // 0-100
  errors: number;
  warnings: number;
  duration?: number; // Milliseconds
  lastBuildTime?: number; // Timestamp
}

/**
 * Complete process status
 */
export interface ProcessStatusInfo {
  name: string;
  status: ProcessStatus;
  category: string;
  pid?: number;
  resources?: ProcessResourceUsage;
  buildMetrics?: BuildMetrics;
  restartCount: number;
  lastStartTime?: number;
  healthCheckStatus?: 'pending' | 'checking' | 'passed' | 'failed';
}

/**
 * Status snapshot of all processes
 */
export interface StatusSnapshot {
  timestamp: number;
  processes: Map<string, ProcessStatusInfo>;
  summary: {
    total: number;
    running: number;
    building: number;
    failed: number;
    stopped: number;
  };
}

/**
 * Status monitor options
 */
export interface StatusMonitorOptions {
  /**
   * Update interval in milliseconds
   */
  updateInterval?: number;

  /**
   * Track resource usage
   */
  trackResources?: boolean;

  /**
   * Track build metrics
   */
  trackBuildMetrics?: boolean;
}

/**
 * Real-time status monitoring system
 *
 * Aggregates process status, resource usage, and build metrics
 * and provides snapshots for the overview pane
 */
export class StatusMonitor extends EventEmitter {
  private processes: Map<string, ProcessStatusInfo> = new Map();
  private updateTimer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(private options: StatusMonitorOptions = {}) {
    super();
    this.options.updateInterval = options.updateInterval ?? 1000;
    this.options.trackResources = options.trackResources ?? true;
    this.options.trackBuildMetrics = options.trackBuildMetrics ?? true;
  }

  /**
   * Register a process for monitoring
   */
  registerProcess(name: string, category: string, pid?: number): void {
    this.processes.set(name, {
      name,
      status: 'pending',
      category,
      pid,
      restartCount: 0,
      buildMetrics: {
        errors: 0,
        warnings: 0,
      },
    });
  }

  /**
   * Update process status
   */
  updateProcessStatus(name: string, status: ProcessStatus): void {
    const info = this.processes.get(name);
    if (!info) return;

    info.status = status;
    if (status === 'running' && !info.lastStartTime) {
      info.lastStartTime = Date.now();
    }

    this.processes.set(name, info);
    this.emitSnapshot();
  }

  /**
   * Update process PID
   */
  updateProcessPid(name: string, pid: number): void {
    const info = this.processes.get(name);
    if (!info) return;

    info.pid = pid;
    this.processes.set(name, info);
  }

  /**
   * Update health check status
   */
  updateHealthCheckStatus(
    name: string,
    status: 'pending' | 'checking' | 'passed' | 'failed'
  ): void {
    const info = this.processes.get(name);
    if (!info) return;

    info.healthCheckStatus = status;
    this.processes.set(name, info);
    this.emitSnapshot();
  }

  /**
   * Increment restart count
   */
  incrementRestartCount(name: string): void {
    const info = this.processes.get(name);
    if (!info) return;

    info.restartCount++;
    this.processes.set(name, info);
  }

  /**
   * Update build metrics
   */
  updateBuildMetrics(name: string, metrics: Partial<BuildMetrics>): void {
    const info = this.processes.get(name);
    if (!info) return;

    const currentMetrics = info.buildMetrics ?? {
      errors: 0,
      warnings: 0,
    };

    info.buildMetrics = {
      ...currentMetrics,
      ...metrics,
      errors: metrics.errors ?? currentMetrics.errors,
      warnings: metrics.warnings ?? currentMetrics.warnings,
    };

    if (metrics.progress === 100 && info.buildMetrics) {
      info.buildMetrics.lastBuildTime = Date.now();
    }

    this.processes.set(name, info);
    this.emitSnapshot();
  }

  /**
   * Get resource usage for a process
   */
  private async getResourceUsage(pid: number): Promise<ProcessResourceUsage | undefined> {
    try {
      // Use ps command to get CPU and memory usage
      const { stdout } = await execAsync(`ps -p ${pid} -o %cpu,%mem,etime | tail -n 1`);

      const parts = stdout.trim().split(/\s+/);
      if (parts.length < 3) return undefined;

      const cpu = parseFloat(parts[0]);
      const memPercent = parseFloat(parts[1]);

      // Get total memory to calculate MB
      const { stdout: memInfo } = await execAsync(
        'sysctl -n hw.memsize 2>/dev/null || grep MemTotal /proc/meminfo 2>/dev/null || echo "0"'
      );

      let totalMemMB = 0;
      if (memInfo.includes('MemTotal')) {
        // Linux
        const match = memInfo.match(/MemTotal:\s+(\d+)/);
        if (match) {
          totalMemMB = parseInt(match[1]) / 1024; // Convert KB to MB
        }
      } else {
        // macOS
        totalMemMB = parseInt(memInfo.trim()) / 1024 / 1024; // Convert bytes to MB
      }

      const memory = (totalMemMB * memPercent) / 100;

      // Parse uptime (format: [[dd-]hh:]mm:ss)
      const etime = parts[2];
      let uptime = 0;
      const timeParts = etime.split(/[-:]/);
      if (timeParts.length === 1) {
        uptime = parseInt(timeParts[0]);
      } else if (timeParts.length === 2) {
        uptime = parseInt(timeParts[0]) * 60 + parseInt(timeParts[1]);
      } else if (timeParts.length === 3) {
        uptime =
          parseInt(timeParts[0]) * 3600 + parseInt(timeParts[1]) * 60 + parseInt(timeParts[2]);
      } else if (timeParts.length === 4) {
        uptime =
          parseInt(timeParts[0]) * 86400 +
          parseInt(timeParts[1]) * 3600 +
          parseInt(timeParts[2]) * 60 +
          parseInt(timeParts[3]);
      }

      return {
        cpu: Math.round(cpu * 10) / 10,
        memory: Math.round(memory * 10) / 10,
        uptime,
      };
    } catch (_error) {
      // Process may have exited
      return undefined;
    }
  }

  /**
   * Update resource usage for all processes
   */
  private async updateResourceUsage(): Promise<void> {
    if (!this.options.trackResources) return;

    const updates = Array.from(this.processes.entries()).map(async ([name, info]) => {
      if (info.pid && (info.status === 'running' || info.status === 'building')) {
        const resources = await this.getResourceUsage(info.pid);
        if (resources) {
          info.resources = resources;
          this.processes.set(name, info);
        }
      }
    });

    await Promise.all(updates);
  }

  /**
   * Start monitoring
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.updateTimer = setInterval(() => {
      void this.tick();
    }, this.options.updateInterval);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = undefined;
    }
  }

  /**
   * Monitoring tick - update all metrics
   */
  private async tick(): Promise<void> {
    await this.updateResourceUsage();
    this.emitSnapshot();
  }

  /**
   * Get current status snapshot
   */
  getSnapshot(): StatusSnapshot {
    const summary = {
      total: this.processes.size,
      running: 0,
      building: 0,
      failed: 0,
      stopped: 0,
    };

    for (const info of this.processes.values()) {
      if (info.status === 'running') summary.running++;
      else if (info.status === 'building') summary.building++;
      else if (info.status === 'failed') summary.failed++;
      else if (info.status === 'stopped') summary.stopped++;
    }

    return {
      timestamp: Date.now(),
      processes: new Map(this.processes),
      summary,
    };
  }

  /**
   * Emit snapshot event
   */
  private emitSnapshot(): void {
    this.emit('snapshot', this.getSnapshot());
  }

  /**
   * Remove a process from monitoring
   */
  unregisterProcess(name: string): void {
    this.processes.delete(name);
    this.emitSnapshot();
  }

  /**
   * Clear all processes
   */
  clear(): void {
    this.processes.clear();
    this.emitSnapshot();
  }
}
