/**
 * Enhanced orchestrator with full process lifecycle management and status monitoring
 */

import { EventEmitter } from 'node:events';
import type { OrckitConfig, ProcessStatus } from '@/types';
import { parseConfig, validateConfig } from './config/parser.js';
import { resolveDependencies, groupIntoWaves } from './dependency/resolver.js';
import { StatusMonitor, type StatusSnapshot } from './status/monitor.js';
import { formatStatusSnapshot } from './status/formatter.js';
import { TmuxManager } from './tmux/manager.js';
import { runPreflight } from './preflight/runner.js';
import { ProcessRunner } from '@/runners/base.js';
import { createRunner } from '@/runners/factory.js';
import { BootLogger } from './boot/logger.js';

/**
 * Orchestrator options
 */
export interface OrchestratorOptions {
  /**
   * Path to configuration file
   */
  configPath?: string;

  /**
   * Configuration object
   */
  config?: OrckitConfig;

  /**
   * Enable status monitoring
   */
  enableStatusMonitor?: boolean;

  /**
   * Enable tmux integration
   */
  enableTmux?: boolean;

  /**
   * Status update interval (ms)
   */
  statusUpdateInterval?: number;
}

/**
 * Enhanced orchestrator with complete process lifecycle management
 */
export class Orchestrator extends EventEmitter {
  private config: OrckitConfig;
  private runners: Map<string, ProcessRunner> = new Map();
  private startOrder: string[] = [];
  private statusMonitor?: StatusMonitor;
  private tmuxManager?: TmuxManager;
  private bootLogger: BootLogger;
  private overviewUpdateTimer?: NodeJS.Timeout;

  constructor(options: OrchestratorOptions) {
    super();

    // Load and validate config
    if (options.configPath) {
      this.config = parseConfig(options.configPath);
    } else if (options.config) {
      this.config = validateConfig(options.config);
    } else {
      throw new Error('Either configPath or config must be provided');
    }

    // Resolve dependencies
    this.startOrder = resolveDependencies(this.config);

    // Initialize boot logger
    const bootStyle = this.config.maestro?.boot?.style ?? 'timeline';
    this.bootLogger = new BootLogger(bootStyle);

    // Initialize status monitor if enabled
    if (options.enableStatusMonitor !== false) {
      this.statusMonitor = new StatusMonitor({
        updateInterval: options.statusUpdateInterval ?? 1000,
        trackResources: true,
        trackBuildMetrics: true,
      });

      // Forward status events
      this.statusMonitor.on('snapshot', (snapshot: StatusSnapshot) => {
        this.emit('status:update', snapshot);

        // Update tmux overview if enabled
        if (this.tmuxManager) {
          const formatted = formatStatusSnapshot(snapshot);
          void this.tmuxManager.updateOverview(formatted);
        }
      });
    }

    // Initialize tmux if enabled (default enabled, always use tmux)
    if (options.enableTmux !== false) {
      this.tmuxManager = new TmuxManager(this.config.project ?? 'orckit');
    }
  }

  /**
   * Start all processes or specific processes
   */
  async start(processNames?: string[]): Promise<void> {
    const toStart = processNames ?? this.startOrder;

    // Print header
    this.bootLogger.printHeader(this.config.project);

    // Run preflight checks
    this.bootLogger.printPhaseHeader('Preflight Checks');
    const preflightResults = await runPreflight(this.config);

    for (const result of preflightResults) {
      this.bootLogger.printPreflightCheck(result);
    }

    const failed = preflightResults.filter((r: { passed: boolean }) => !r.passed);
    if (failed.length > 0) {
      throw new Error(
        `Preflight checks failed: ${failed.map((r: { name: string }) => r.name).join(', ')}`
      );
    }

    // Create tmux session if enabled
    if (this.tmuxManager) {
      await this.tmuxManager.createSession();
    }

    // Start status monitor
    if (this.statusMonitor) {
      this.statusMonitor.start();
    }

    // Group processes into waves
    const waves = groupIntoWaves(this.config);
    const processesToStart = toStart.filter((name) => this.config.processes[name]);

    // Register all processes with status monitor
    if (this.statusMonitor) {
      for (const name of processesToStart) {
        const process = this.config.processes[name];
        this.statusMonitor.registerProcess(name, process.category);
      }
    }

    // Create tmux windows for categories
    if (this.tmuxManager) {
      const categories = new Set(
        processesToStart.map((name) => this.config.processes[name].category)
      );

      for (const category of categories) {
        const categoryConfig = this.config.categories?.[category];
        await this.tmuxManager.createWindow(category, categoryConfig?.window ?? category);
      }
    }

    // Start processes wave by wave
    this.bootLogger.printPhaseHeader('Starting Processes');

    for (const wave of waves) {
      const waveProcesses = wave.filter((name) => processesToStart.includes(name));

      if (waveProcesses.length === 0) continue;

      // Start all processes in this wave in parallel
      await Promise.all(waveProcesses.map((name) => this.startProcess(name)));
    }

    this.bootLogger.printCompletion(processesToStart.length);
    this.emit('all:ready');

    // Start overview pane updates if tmux is enabled
    if (this.tmuxManager && this.statusMonitor) {
      this.startOverviewUpdates();
    }
  }

  /**
   * Start a single process
   */
  private async startProcess(name: string): Promise<void> {
    const processConfig = this.config.processes[name];
    if (!processConfig) {
      throw new Error(`Process '${name}' not found`);
    }

    this.bootLogger.printProcessStarting(name, 0, processConfig.category ?? 'default');

    // Update status monitor
    if (this.statusMonitor) {
      this.statusMonitor.updateProcessStatus(name, 'starting');
    }

    this.emit('process:starting', { processName: name, timestamp: new Date() });

    try {
      // Create process runner
      const runner = createRunner(name, processConfig);

      // Register event handlers
      runner.on('status', (status: ProcessStatus) => {
        if (this.statusMonitor) {
          this.statusMonitor.updateProcessStatus(name, status);
        }
        this.emit('process:status', { processName: name, status });
      });

      runner.on('ready', () => {
        this.bootLogger.printProcessReady(name);
        this.emit('process:ready', { processName: name, timestamp: new Date() });
      });

      runner.on('failed', (error: Error) => {
        this.emit('process:failed', { processName: name, error });
      });

      runner.on('restarting', (count: number) => {
        if (this.statusMonitor) {
          this.statusMonitor.incrementRestartCount(name);
        }
        this.emit('process:restarting', { processName: name, restartCount: count });
      });

      runner.on('build:progress', (progress: number) => {
        if (this.statusMonitor) {
          this.statusMonitor.updateBuildMetrics(name, { progress });
        }
      });

      runner.on('build:stats', (stats: { errors: number; warnings: number }) => {
        if (this.statusMonitor) {
          this.statusMonitor.updateBuildMetrics(name, stats);
        }
      });

      // Start the process
      await runner.start();

      // Update status monitor with PID
      if (this.statusMonitor && runner.pid) {
        this.statusMonitor.updateProcessPid(name, runner.pid);
      }

      this.runners.set(name, runner);
    } catch (error) {
      if (this.statusMonitor) {
        this.statusMonitor.updateProcessStatus(name, 'failed');
      }
      throw error;
    }
  }

  /**
   * Stop processes
   */
  async stop(processNames?: string[]): Promise<void> {
    const toStop = processNames ?? [...this.startOrder].reverse();

    for (const name of toStop) {
      const runner = this.runners.get(name);
      if (runner) {
        await runner.stop();
        this.runners.delete(name);

        if (this.statusMonitor) {
          this.statusMonitor.updateProcessStatus(name, 'stopped');
        }

        this.emit('process:stopped', { processName: name, timestamp: new Date() });
      }
    }

    // Stop overview updates
    if (this.overviewUpdateTimer) {
      clearInterval(this.overviewUpdateTimer);
      this.overviewUpdateTimer = undefined;
    }

    // Stop status monitor
    if (this.statusMonitor) {
      this.statusMonitor.stop();
    }

    // Kill tmux session
    if (this.tmuxManager) {
      await this.tmuxManager.killSession();
    }
  }

  /**
   * Restart processes
   */
  async restart(processNames: string[]): Promise<void> {
    for (const name of processNames) {
      const runner = this.runners.get(name);
      if (runner) {
        await runner.restart();
      }
    }
  }

  /**
   * Get process status
   */
  getStatus(processName?: string): ProcessStatus | Map<string, ProcessStatus> {
    if (processName) {
      const runner = this.runners.get(processName);
      return runner?.status ?? 'pending';
    }

    const statuses = new Map<string, ProcessStatus>();
    for (const [name, runner] of this.runners.entries()) {
      statuses.set(name, runner.status);
    }
    return statuses;
  }

  /**
   * Get status snapshot
   */
  getStatusSnapshot() {
    return this.statusMonitor?.getSnapshot();
  }

  /**
   * Start overview pane updates
   */
  private startOverviewUpdates(): void {
    if (this.overviewUpdateTimer) return;

    // Initial update
    if (this.statusMonitor) {
      const snapshot = this.statusMonitor.getSnapshot();
      const formatted = formatStatusSnapshot(snapshot);
      void this.tmuxManager?.updateOverview(formatted);
    }

    // Periodic updates (less frequent than status monitor)
    this.overviewUpdateTimer = setInterval(() => {
      if (this.statusMonitor) {
        const snapshot = this.statusMonitor.getSnapshot();
        const formatted = formatStatusSnapshot(snapshot);
        void this.tmuxManager?.updateOverview(formatted);
      }
    }, 2000); // Update every 2 seconds
  }

  /**
   * Attach to tmux session
   */
  async attach(): Promise<void> {
    if (!this.tmuxManager) {
      throw new Error('tmux integration is not enabled');
    }
    await this.tmuxManager.attach();
  }

  /**
   * Get configuration
   */
  getConfig(): OrckitConfig {
    return this.config;
  }

  /**
   * Get process names in start order
   */
  getProcessNames(): string[] {
    return this.startOrder;
  }
}
