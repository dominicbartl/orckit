/**
 * Process Manager
 *
 * Handles the lifecycle of process runners:
 * - Creating runners via factory
 * - Starting, stopping, restarting processes
 * - Event forwarding from runners
 * - Coordinating with StatusMonitor and OutputBufferManager
 *
 * This manager is testable independently by mocking the runner factory.
 */

import { EventEmitter } from 'node:events';
import type { ProcessConfig, ProcessStatus } from '../../types/index.js';
import { ProcessRunner } from '../../runners/base.js';
import { createRunner } from '../../runners/factory.js';
import { StatusMonitor } from '../status/monitor.js';
import { OutputBufferManager } from '../output/buffer-manager.js';
import { IPCServer } from '../ipc/server.js';
import {
  createHealthChecker,
  waitForReady,
  LogPatternHealthChecker,
  type HealthChecker,
} from '../health/checker.js';
import { createDebugLogger } from '../../utils/logger.js';

const debug = createDebugLogger('ProcessManager');

/**
 * Options for ProcessManager
 */
export interface ProcessManagerOptions {
  /**
   * Optional status monitor for tracking process state
   */
  statusMonitor?: StatusMonitor;

  /**
   * Optional output buffer manager for capturing logs
   */
  bufferManager?: OutputBufferManager;

  /**
   * Optional IPC server for broadcasting events
   */
  ipcServer?: IPCServer;
}

/**
 * Events emitted by ProcessManager
 */
export interface ProcessManagerEvents {
  'process:starting': { processName: string; timestamp: Date };
  'process:ready': { processName: string; timestamp: Date };
  'process:status': { processName: string; status: ProcessStatus };
  'process:failed': { processName: string; error: Error };
  'process:stopped': { processName: string; timestamp: Date };
  'process:restarting': { processName: string; restartCount: number };
  'build:progress': { processName: string; progress: number };
  'build:stats': { processName: string; errors: number; warnings: number };
}

/**
 * Process Manager - handles runner lifecycle
 *
 * @example
 * ```ts
 * const processManager = new ProcessManager({
 *   statusMonitor,
 *   bufferManager,
 * });
 *
 * // Register a process
 * processManager.register('api', apiConfig);
 *
 * // Start it
 * await processManager.start('api');
 *
 * // Check status
 * const status = processManager.getStatus('api');
 *
 * // Stop it
 * await processManager.stop('api');
 * ```
 */
export class ProcessManager extends EventEmitter {
  private runners: Map<string, ProcessRunner> = new Map();
  private configs: Map<string, ProcessConfig> = new Map();
  private healthCheckers: Map<string, HealthChecker> = new Map();
  private stoppedProcesses: Set<string> = new Set();
  private statusMonitor?: StatusMonitor;
  private bufferManager?: OutputBufferManager;
  private ipcServer?: IPCServer;

  constructor(options: ProcessManagerOptions = {}) {
    super();
    this.statusMonitor = options.statusMonitor;
    this.bufferManager = options.bufferManager;
    this.ipcServer = options.ipcServer;
  }

  /**
   * Set the status monitor (allows late binding)
   */
  setStatusMonitor(monitor: StatusMonitor): void {
    this.statusMonitor = monitor;
  }

  /**
   * Set the buffer manager (allows late binding)
   */
  setBufferManager(manager: OutputBufferManager): void {
    this.bufferManager = manager;
  }

  /**
   * Set the IPC server (allows late binding)
   */
  setIPCServer(server: IPCServer): void {
    this.ipcServer = server;
  }

  /**
   * Register a process configuration
   */
  register(name: string, config: ProcessConfig): void {
    debug.debug(`Registering process: ${name}`, { type: config.type });
    this.configs.set(name, config);

    // Register with status monitor if available
    if (this.statusMonitor) {
      this.statusMonitor.registerProcess(name, config.category ?? 'default');
    }

    // Create output buffer if manager available
    if (this.bufferManager) {
      const bufferSize = config.output?.format?.max_lines ?? 10000;
      this.bufferManager.createBuffer(name, bufferSize);
    }
  }

  /**
   * Check if a process is registered
   */
  isRegistered(name: string): boolean {
    return this.configs.has(name);
  }

  /**
   * Start a process
   */
  async start(name: string): Promise<void> {
    const config = this.configs.get(name);
    if (!config) {
      throw new Error(`Process '${name}' is not registered`);
    }

    // Don't start if already running
    const existing = this.runners.get(name);
    if (existing && (existing.status === 'running' || existing.status === 'building')) {
      debug.warn(`Process ${name} is already running`);
      return;
    }

    // Clear stopped status if it was previously stopped
    this.stoppedProcesses.delete(name);

    debug.info(`Starting process: ${name}`, {
      type: config.type,
      command: config.command,
    });

    // Update status
    if (this.statusMonitor) {
      this.statusMonitor.updateProcessStatus(name, 'starting');
    }

    this.emit('process:starting', { processName: name, timestamp: new Date() });

    try {
      // Create runner
      const runner = createRunner(name, config);
      debug.debug(`Runner created for ${name}`);

      // Setup event handlers
      this.setupRunnerEvents(name, runner);

      // Create health checker if ready config exists
      let healthChecker: HealthChecker | undefined;
      if (config.ready && config.ready.type !== 'exit-code') {
        healthChecker = createHealthChecker(config.ready);
        this.healthCheckers.set(name, healthChecker);

        // For log-pattern, wire up the checker to process output
        if (config.ready.type === 'log-pattern' && healthChecker instanceof LogPatternHealthChecker) {
          const logChecker = healthChecker;
          runner.on('stdout', (line: string) => {
            if (logChecker.processLogLine(line)) {
              debug.info(`Log pattern matched for ${name}`);
            }
          });
          runner.on('stderr', (line: string) => {
            logChecker.processLogLine(line);
          });
        }
      }

      // Start the runner
      await runner.start();
      debug.info(`Runner started for ${name}`);

      // Store runner
      this.runners.set(name, runner);

      // Update status with PID
      if (this.statusMonitor && runner.pid) {
        this.statusMonitor.updateProcessPid(name, runner.pid);
      }

      // Wait for health check to pass (if configured)
      if (healthChecker && config.ready) {
        debug.info(`Waiting for ${name} to become ready...`, { type: config.ready.type });

        try {
          // Create a promise that rejects if the process exits/fails during health check
          let processExitReject: ((error: Error) => void) | null = null;
          const processExitPromise = new Promise<never>((_, reject) => {
            processExitReject = reject;
          });

          // Listen for process exit during health check
          const exitHandler = (code: number | null) => {
            if (processExitReject) {
              processExitReject(new Error(`Process exited with code ${code} during health check`));
            }
          };
          const failHandler = () => {
            if (processExitReject) {
              processExitReject(new Error('Process failed during health check'));
            }
          };

          runner.on('exit', exitHandler);
          runner.on('failed', failHandler);

          try {
            // Race between health check and process exit
            await Promise.race([
              waitForReady(healthChecker, config.ready, (attempt, result) => {
                debug.debug(`Health check attempt ${attempt} for ${name}`, {
                  success: result.success,
                  message: result.message,
                });
              }),
              processExitPromise,
            ]);
          } finally {
            // Clean up listeners
            runner.off('exit', exitHandler);
            runner.off('failed', failHandler);
            processExitReject = null;
          }

          debug.info(`Process ${name} is ready`);

          // Update status to running
          if (this.statusMonitor) {
            this.statusMonitor.updateProcessStatus(name, 'running');
          }

          this.emit('process:ready', { processName: name, timestamp: new Date() });
        } catch (error) {
          debug.error(`Health check failed for ${name}`, {
            error: error instanceof Error ? error.message : error,
          });

          // Mark as failed if health check times out or process exits
          if (this.statusMonitor) {
            this.statusMonitor.updateProcessStatus(name, 'failed');
          }

          this.emit('process:failed', {
            processName: name,
            error: error instanceof Error ? error : new Error(String(error)),
          });

          // Stop the process since it failed health check (if still running)
          const currentRunner = this.runners.get(name);
          if (currentRunner && currentRunner.status !== 'stopped' && currentRunner.status !== 'failed') {
            await this.stop(name);
          }
          throw error;
        }
      } else {
        // No health check configured - mark as ready immediately
        if (this.statusMonitor) {
          this.statusMonitor.updateProcessStatus(name, 'running');
        }
        this.emit('process:ready', { processName: name, timestamp: new Date() });
      }
    } catch (error) {
      debug.error(`Failed to start process ${name}`, {
        error: error instanceof Error ? error.message : error,
      });

      if (this.statusMonitor) {
        this.statusMonitor.updateProcessStatus(name, 'failed');
      }

      this.emit('process:failed', {
        processName: name,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      throw error;
    }
  }

  /**
   * Stop a process
   */
  async stop(name: string): Promise<void> {
    const runner = this.runners.get(name);
    if (!runner) {
      debug.debug(`Process ${name} is not running`);
      return;
    }

    debug.info(`Stopping process: ${name}`);

    try {
      await runner.stop();
      this.runners.delete(name);
      this.healthCheckers.delete(name);
      this.stoppedProcesses.add(name);

      // Update status
      if (this.statusMonitor) {
        this.statusMonitor.updateProcessStatus(name, 'stopped');
      }

      // Remove buffer
      if (this.bufferManager) {
        this.bufferManager.removeBuffer(name);
      }

      this.emit('process:stopped', { processName: name, timestamp: new Date() });
      debug.info(`Process ${name} stopped`);
    } catch (error) {
      debug.error(`Failed to stop process ${name}`, {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Restart a process
   */
  async restart(name: string): Promise<void> {
    const config = this.configs.get(name);
    if (!config) {
      throw new Error(`Process '${name}' is not registered`);
    }

    const runner = this.runners.get(name);
    if (!runner) {
      // Not running, just start it
      await this.start(name);
      return;
    }

    debug.info(`Restarting process: ${name}`);

    // Emit restarting event
    this.emit('process:restarting', { processName: name, restartCount: 1 });

    // Stop and then start again to ensure clean state
    await this.stop(name);
    await this.start(name);
  }

  /**
   * Get status of a process
   */
  getStatus(name: string): ProcessStatus {
    const runner = this.runners.get(name);
    if (runner) {
      return runner.status;
    }
    // Check if process was explicitly stopped
    if (this.stoppedProcesses.has(name)) {
      return 'stopped';
    }
    return 'pending';
  }

  /**
   * Get all process statuses
   */
  getAllStatuses(): Map<string, ProcessStatus> {
    const statuses = new Map<string, ProcessStatus>();

    // Include both running and registered processes
    for (const name of this.configs.keys()) {
      statuses.set(name, this.getStatus(name));
    }

    return statuses;
  }

  /**
   * Get a runner by name (for advanced use cases)
   */
  getRunner(name: string): ProcessRunner | undefined {
    return this.runners.get(name);
  }

  /**
   * Get all running process names
   */
  getRunningProcesses(): string[] {
    return Array.from(this.runners.keys());
  }

  /**
   * Stop all processes
   */
  async stopAll(): Promise<void> {
    debug.info('Stopping all processes');
    const names = Array.from(this.runners.keys());

    // Stop in reverse order (dependents first)
    for (const name of names.reverse()) {
      await this.stop(name);
    }
  }

  /**
   * Cleanup all resources
   */
  cleanup(): void {
    debug.debug('Cleaning up ProcessManager');
    this.runners.clear();
    this.configs.clear();
  }

  /**
   * Setup event handlers for a runner
   */
  private setupRunnerEvents(name: string, runner: ProcessRunner): void {
    runner.on('status', (status: ProcessStatus) => {
      debug.debug(`Process ${name} status: ${status}`);

      if (this.statusMonitor) {
        this.statusMonitor.updateProcessStatus(name, status);
      }

      this.emit('process:status', { processName: name, status });
    });

    runner.on('ready', () => {
      debug.info(`Process ${name} is ready`);
      this.emit('process:ready', { processName: name, timestamp: new Date() });
    });

    runner.on('failed', (error: Error) => {
      debug.error(`Process ${name} failed`, { error: error?.message });
      this.emit('process:failed', { processName: name, error });
    });

    runner.on('restarting', (count: number) => {
      debug.warn(`Process ${name} restarting (attempt ${count})`);

      if (this.statusMonitor) {
        this.statusMonitor.incrementRestartCount(name);
      }

      this.emit('process:restarting', { processName: name, restartCount: count });
    });

    runner.on('build:progress', (progress: number) => {
      debug.debug(`Process ${name} build progress: ${progress}%`);

      if (this.statusMonitor) {
        this.statusMonitor.updateBuildMetrics(name, { progress });
      }

      this.emit('build:progress', { processName: name, progress });
    });

    runner.on('build:stats', (stats: { errors: number; warnings: number }) => {
      debug.debug(`Process ${name} build stats`, stats);

      if (this.statusMonitor) {
        this.statusMonitor.updateBuildMetrics(name, stats);
      }

      this.emit('build:stats', { processName: name, ...stats });
    });

    // Forward stdout/stderr to buffer and IPC
    runner.on('stdout', (data: string) => {
      if (this.bufferManager) {
        this.bufferManager.appendLine(name, data, 'stdout');
      }
      if (this.ipcServer) {
        this.ipcServer.broadcastLog(name, 'stdout', data);
      }
    });

    runner.on('stderr', (data: string) => {
      if (this.bufferManager) {
        this.bufferManager.appendLine(name, data, 'stderr');
      }
      if (this.ipcServer) {
        this.ipcServer.broadcastLog(name, 'stderr', data);
      }
    });
  }
}
