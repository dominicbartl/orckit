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
import { createDebugLogger } from '@/utils/logger.js';

const debug = createDebugLogger('Orchestrator');

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

    debug.debug('Initializing orchestrator', { options });

    // Load and validate config
    if (options.configPath) {
      debug.debug('Loading config from path', { path: options.configPath });
      this.config = parseConfig(options.configPath);
    } else if (options.config) {
      debug.debug('Validating provided config');
      this.config = validateConfig(options.config);
    } else {
      throw new Error('Either configPath or config must be provided');
    }

    debug.info('Config loaded', {
      project: this.config.project,
      processCount: Object.keys(this.config.processes).length,
    });

    // Resolve dependencies
    const endTimer = debug.time('Dependency resolution');
    this.startOrder = resolveDependencies(this.config);
    endTimer();
    debug.info('Dependency resolution complete', { startOrder: this.startOrder });

    // Initialize boot logger
    const bootStyle = this.config.maestro?.boot?.style ?? 'timeline';
    this.bootLogger = new BootLogger(bootStyle);
    debug.debug('Boot logger initialized', { style: bootStyle });

    // Initialize status monitor if enabled
    if (options.enableStatusMonitor !== false) {
      debug.debug('Initializing status monitor');
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
      debug.info('Status monitor initialized');
    }

    // Initialize tmux if enabled (default enabled, always use tmux)
    if (options.enableTmux !== false) {
      debug.debug('Initializing tmux manager', { project: this.config.project ?? 'orckit' });
      this.tmuxManager = new TmuxManager(this.config.project ?? 'orckit');
      debug.info('Tmux manager initialized');
    }

    debug.info('Orchestrator initialized successfully');
  }

  /**
   * Start all processes or specific processes
   */
  async start(processNames?: string[]): Promise<void> {
    const startTimer = debug.time('Orchestrator start');
    const toStart = processNames ?? this.startOrder;

    debug.info('Starting orchestration', {
      requestedProcesses: processNames,
      actualProcesses: toStart,
    });

    // Print header
    this.bootLogger.printHeader(this.config.project);

    // Run preflight checks
    debug.debug('Running preflight checks');
    this.bootLogger.printPhaseHeader('Preflight Checks');
    const preflightResults = await runPreflight(this.config);

    for (const result of preflightResults) {
      this.bootLogger.printPreflightCheck(result);
      debug.debug('Preflight check result', result);
    }

    const failed = preflightResults.filter((r: { passed: boolean }) => !r.passed);
    if (failed.length > 0) {
      debug.error('Preflight checks failed', { failed });
      throw new Error(
        `Preflight checks failed: ${failed.map((r: { name: string }) => r.name).join(', ')}`
      );
    }
    debug.info('Preflight checks passed');

    // Create tmux session if enabled
    if (this.tmuxManager) {
      debug.debug('Creating tmux session');
      await this.tmuxManager.createSession();
      debug.info('Tmux session created');
    }

    // Start status monitor
    if (this.statusMonitor) {
      debug.debug('Starting status monitor');
      this.statusMonitor.start();
      debug.info('Status monitor started');
    }

    // Group processes into waves
    const waveTimer = debug.time('Wave grouping');
    const waves = groupIntoWaves(this.config);
    waveTimer();
    debug.info('Processes grouped into waves', {
      waveCount: waves.length,
      waves: waves.map((w, i) => ({ wave: i + 1, processes: w })),
    });

    const processesToStart = toStart.filter((name) => this.config.processes[name]);
    debug.info('Filtered processes to start', { processesToStart });

    // Register all processes with status monitor
    if (this.statusMonitor) {
      debug.debug('Registering processes with status monitor');
      for (const name of processesToStart) {
        const process = this.config.processes[name];
        this.statusMonitor.registerProcess(name, process.category);
        debug.debug('Registered process', { name, category: process.category });
      }
    }

    // Create tmux windows for categories
    if (this.tmuxManager) {
      const categories = new Set(
        processesToStart.map((name) => this.config.processes[name].category)
      );
      debug.debug('Creating tmux windows for categories', { categories: Array.from(categories) });

      for (const category of categories) {
        const categoryConfig = this.config.categories?.[category];
        const windowName = categoryConfig?.window ?? category;
        debug.debug('Creating tmux window', { category, windowName });
        await this.tmuxManager.createWindow(category, windowName);
      }
      debug.info('Tmux windows created');
    }

    // Start processes wave by wave
    this.bootLogger.printPhaseHeader('Starting Processes');

    for (let i = 0; i < waves.length; i++) {
      const wave = waves[i];
      const waveProcesses = wave.filter((name) => processesToStart.includes(name));

      if (waveProcesses.length === 0) {
        debug.debug(`Wave ${i + 1} is empty, skipping`);
        continue;
      }

      debug.info(`Starting wave ${i + 1}/${waves.length}`, { processes: waveProcesses });

      // Start all processes in this wave in parallel
      const waveStartTimer = debug.time(`Wave ${i + 1} startup`);
      await Promise.all(waveProcesses.map((name) => this.startProcess(name)));
      waveStartTimer();

      debug.info(`Wave ${i + 1} completed`);
    }

    this.bootLogger.printCompletion(processesToStart.length);
    this.emit('all:ready');
    startTimer();
    debug.info('Orchestration started successfully');

    // Start overview pane updates if tmux is enabled
    if (this.tmuxManager && this.statusMonitor) {
      this.startOverviewUpdates();
    }
  }

  /**
   * Start a single process
   */
  private async startProcess(name: string): Promise<void> {
    const processTimer = debug.time(`Process ${name} startup`);
    const processConfig = this.config.processes[name];

    if (!processConfig) {
      debug.error('Process not found in config', { name });
      throw new Error(`Process '${name}' not found`);
    }

    debug.info(`Starting process: ${name}`, {
      type: processConfig.type,
      category: processConfig.category,
      command: processConfig.command,
      dependencies: processConfig.dependencies,
    });

    this.bootLogger.printProcessStarting(name, 0, processConfig.category ?? 'default');

    // Update status monitor
    if (this.statusMonitor) {
      this.statusMonitor.updateProcessStatus(name, 'starting');
    }

    this.emit('process:starting', { processName: name, timestamp: new Date() });

    try {
      // Create process runner
      debug.debug(`Creating runner for ${name}`, { type: processConfig.type });
      const runner = createRunner(name, processConfig, this.tmuxManager);
      debug.debug(`Runner created for ${name}`);

      // Register event handlers
      runner.on('status', (status: ProcessStatus) => {
        debug.debug(`Process ${name} status changed`, { status });
        if (this.statusMonitor) {
          this.statusMonitor.updateProcessStatus(name, status);
        }
        this.emit('process:status', { processName: name, status });
      });

      runner.on('ready', () => {
        debug.info(`Process ${name} is ready`);
        this.bootLogger.printProcessReady(name);
        this.emit('process:ready', { processName: name, timestamp: new Date() });
      });

      runner.on('failed', (error: Error) => {
        debug.error(`Process ${name} failed`, { error: error.message });
        this.emit('process:failed', { processName: name, error });
      });

      runner.on('restarting', (count: number) => {
        debug.warn(`Process ${name} restarting`, { attempt: count });
        if (this.statusMonitor) {
          this.statusMonitor.incrementRestartCount(name);
        }
        this.emit('process:restarting', { processName: name, restartCount: count });
      });

      runner.on('build:progress', (progress: number) => {
        debug.debug(`Process ${name} build progress`, { progress });
        if (this.statusMonitor) {
          this.statusMonitor.updateBuildMetrics(name, { progress });
        }
      });

      runner.on('build:stats', (stats: { errors: number; warnings: number }) => {
        debug.debug(`Process ${name} build stats`, stats);
        if (this.statusMonitor) {
          this.statusMonitor.updateBuildMetrics(name, stats);
        }
      });

      // Start the process
      debug.debug(`Starting runner for ${name}`);
      await runner.start();
      debug.info(`Runner for ${name} started successfully`);

      // Update status monitor with PID
      if (this.statusMonitor && runner.pid) {
        debug.debug(`Process ${name} PID`, { pid: runner.pid });
        this.statusMonitor.updateProcessPid(name, runner.pid);
      }

      this.runners.set(name, runner);
      processTimer();
    } catch (error) {
      debug.error(`Failed to start process ${name}`, {
        error: error instanceof Error ? error.message : error,
      });
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
