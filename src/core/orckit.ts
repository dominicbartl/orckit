/**
 * Orckit - Main Orchestrator Class
 *
 * This is the primary API for orchestrating processes.
 * It composes focused managers for different responsibilities:
 *
 * - ConfigManager: Configuration loading, validation, dependency resolution
 * - ProcessManager: Runner lifecycle (start/stop/restart)
 * - StatusMonitor: Real-time status and resource tracking
 * - OutputBufferManager: Process output buffering
 * - BootLogger: Boot sequence display
 *
 * Each manager is independently testable.
 */

import { EventEmitter } from 'node:events';
import type {
  OrckitConfig,
  ProcessStatus,
} from '../types/index.js';
import { ConfigManager, type ConfigManagerOptions } from './config/manager.js';
import { ProcessManager } from './process/manager.js';
import { StatusMonitor, type StatusSnapshot } from './status/monitor.js';
import { OutputBufferManager } from './output/buffer-manager.js';
import { BootLogger } from './boot/logger.js';
import { runPreflight } from './preflight/runner.js';
import { createDebugLogger } from '../utils/logger.js';

const debug = createDebugLogger('Orckit');

/**
 * Options for creating an Orckit instance
 */
export interface OrckitOptions extends ConfigManagerOptions {
  /**
   * Enable status monitoring (default: true)
   */
  enableStatusMonitor?: boolean;

  /**
   * Status update interval in milliseconds (default: 1000)
   */
  statusUpdateInterval?: number;

  /**
   * Default buffer size for process output (default: 10000)
   */
  bufferSize?: number;

  /**
   * Skip preflight checks (default: false)
   */
  skipPreflight?: boolean;

  /**
   * Print process stdout/stderr to terminal (default: false)
   */
  processDebug?: boolean;

  /**
   * Run in headless mode - disables interactive prompts (default: false)
   */
  headless?: boolean;
}

/**
 * Orckit Events
 */
export interface OrckitEvents {
  'process:starting': { processName: string; timestamp: Date };
  'process:ready': { processName: string; timestamp: Date };
  'process:status': { processName: string; status: ProcessStatus };
  'process:failed': { processName: string; error: Error };
  'process:stopped': { processName: string; timestamp: Date };
  'process:restarting': { processName: string; restartCount: number };
  'status:update': StatusSnapshot;
  'all:ready': void;
}

/**
 * Main Orckit Orchestrator
 *
 * @example
 * ```ts
 * // Create from config file
 * const orckit = new Orckit({ configPath: './orckit.yaml' });
 *
 * // Start all processes
 * await orckit.start();
 *
 * // Or start specific processes
 * await orckit.start(['api', 'frontend']);
 *
 * // Get status
 * const status = orckit.getStatus('api');
 *
 * // Stop all
 * await orckit.stop();
 * ```
 */
export class Orckit extends EventEmitter {
  // Managers
  private readonly configManager: ConfigManager;
  private readonly processManager: ProcessManager;
  private readonly statusMonitor: StatusMonitor | null;
  private readonly bufferManager: OutputBufferManager;
  private readonly bootLogger: BootLogger;

  // Options
  private readonly options: Required<
    Pick<OrckitOptions, 'enableStatusMonitor' | 'skipPreflight' | 'processDebug' | 'headless'>
  >;

  // State
  private isStarted = false;

  constructor(options: OrckitOptions) {
    super();

    debug.debug('Initializing Orckit', { options });

    // Store options with defaults
    this.options = {
      enableStatusMonitor: options.enableStatusMonitor ?? true,
      skipPreflight: options.skipPreflight ?? false,
      processDebug: options.processDebug ?? false,
      headless: options.headless ?? false,
    };

    // Initialize ConfigManager (handles config loading and dependency resolution)
    this.configManager = new ConfigManager({
      configPath: options.configPath,
      config: options.config,
    });

    debug.info('Config loaded', {
      project: this.configManager.getProjectName(),
      processCount: this.configManager.getProcessNames().length,
      startOrder: this.configManager.getStartOrder(),
    });

    // Initialize OutputBufferManager
    this.bufferManager = new OutputBufferManager({
      defaultBufferSize: options.bufferSize ?? 10000,
    });

    // Initialize StatusMonitor if enabled
    if (this.options.enableStatusMonitor) {
      this.statusMonitor = new StatusMonitor({
        updateInterval: options.statusUpdateInterval ?? 1000,
        trackResources: true,
        trackBuildMetrics: true,
      });

      // Forward status snapshots
      this.statusMonitor.on('snapshot', (snapshot: StatusSnapshot) => {
        this.emit('status:update', snapshot);
      });
    } else {
      this.statusMonitor = null;
    }

    // Initialize ProcessManager
    this.processManager = new ProcessManager({
      statusMonitor: this.statusMonitor ?? undefined,
      bufferManager: this.bufferManager,
      processDebug: this.options.processDebug,
    });

    // Register all processes (so getStatus works before start)
    for (const name of this.configManager.getProcessNames()) {
      const config = this.configManager.getProcessConfig(name);
      if (config) {
        this.processManager.register(name, config);
      }
    }

    // Forward process events
    this.setupProcessManagerEvents();

    // Initialize BootLogger
    const bootStyle = this.configManager.getBootConfig()?.style ?? 'timeline';
    this.bootLogger = new BootLogger(bootStyle);

    debug.info('Orckit initialized successfully');
  }

  /**
   * Start all processes or specific processes
   */
  async start(processNames?: string[]): Promise<void> {
    const startTimer = debug.time('Orckit start');

    // Get filtered start order (includes dependencies)
    const toStart = this.configManager.filterStartOrder(processNames);

    debug.info('Starting orchestration', {
      requested: processNames ?? 'all',
      actual: toStart,
    });

    // Print header
    this.bootLogger.printHeader(this.configManager.getProjectName());

    // Run preflight checks
    if (!this.options.skipPreflight) {
      debug.debug('Running preflight checks');
      this.bootLogger.printPhaseHeader('Preflight Checks');

      // In headless mode, disable interactive prompts
      const interactive = !this.options.headless;
      const preflightResults = await runPreflight(this.configManager.getConfig(), interactive);

      for (const result of preflightResults) {
        this.bootLogger.printPreflightCheck(result);
        debug.debug('Preflight check result', result);
      }

      const failed = preflightResults.filter((r) => !r.passed);
      if (failed.length > 0) {
        debug.error('Preflight checks failed', { failed });
        throw new Error(
          `Preflight checks failed: ${failed.map((r) => r.name).join(', ')}`
        );
      }

      debug.info('Preflight checks passed');
    }

    // Start status monitor
    if (this.statusMonitor) {
      debug.debug('Starting status monitor');
      this.statusMonitor.start();
    }

    // Start processes wave by wave
    this.bootLogger.printPhaseHeader('Starting Processes');

    const waves = this.configManager.filterWaves(processNames);
    debug.info('Starting waves', {
      waveCount: waves.length,
      waves: waves.map((w, i) => ({ wave: i + 1, processes: w })),
    });

    for (let i = 0; i < waves.length; i++) {
      const wave = waves[i];
      const waveProcesses = wave.filter((name) => toStart.includes(name));

      if (waveProcesses.length === 0) {
        continue;
      }

      debug.info(`Starting wave ${i + 1}/${waves.length}`, { processes: waveProcesses });

      // Start all processes in this wave in parallel
      await Promise.all(
        waveProcesses.map((name) => this.startProcess(name))
      );

      debug.info(`Wave ${i + 1} completed`);
    }

    this.bootLogger.printCompletion(toStart.length);
    this.isStarted = true;
    this.emit('all:ready');

    startTimer();
    debug.info('Orchestration started successfully');
  }

  /**
   * Stop all processes or specific processes
   */
  async stop(processNames?: string[]): Promise<void> {
    const stopTimer = debug.time('Orckit stop');

    const toStop = processNames ?? [...this.configManager.getStartOrder()].reverse();

    debug.info('Stopping processes', { processes: toStop });

    for (const name of toStop) {
      await this.processManager.stop(name);
    }

    // Stop status monitor
    if (this.statusMonitor) {
      this.statusMonitor.stop();
    }

    // Cleanup buffers
    this.bufferManager.cleanup();

    this.isStarted = false;
    stopTimer();
    debug.info('Processes stopped');
  }

  /**
   * Restart specific processes
   */
  async restart(processNames: string[]): Promise<void> {
    debug.info('Restarting processes', { processes: processNames });

    for (const name of processNames) {
      await this.processManager.restart(name);
    }

    debug.info('Processes restarted');
  }

  /**
   * Get status of a specific process or all processes
   */
  getStatus(processName?: string): ProcessStatus | Map<string, ProcessStatus> {
    if (processName) {
      return this.processManager.getStatus(processName);
    }
    return this.processManager.getAllStatuses();
  }

  /**
   * Get current status snapshot (for detailed monitoring)
   */
  getStatusSnapshot(): StatusSnapshot | undefined {
    return this.statusMonitor?.getSnapshot();
  }

  /**
   * Wait for a process to become ready
   */
  async waitForReady(processName: string, options?: { timeout?: number }): Promise<boolean> {
    const timeout = options?.timeout ?? 30000;
    const startTime = Date.now();

    debug.debug('Waiting for process to be ready', { processName, timeout });

    while (Date.now() - startTime < timeout) {
      const status = this.processManager.getStatus(processName);
      if (status === 'running') {
        debug.info('Process is ready', {
          processName,
          elapsed: Date.now() - startTime,
        });
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    debug.warn('Process ready timeout', { processName, timeout });
    return false;
  }

  /**
   * Get the configuration
   */
  getConfig(): OrckitConfig {
    return this.configManager.getConfig();
  }

  /**
   * Get process names in start order
   */
  getProcessNames(): string[] {
    return this.configManager.getStartOrder();
  }

  /**
   * Get the output buffer manager
   */
  getBufferManager(): OutputBufferManager {
    return this.bufferManager;
  }

  /**
   * Get the config manager (for advanced use)
   */
  getConfigManager(): ConfigManager {
    return this.configManager;
  }

  /**
   * Get the process manager (for advanced use)
   */
  getProcessManager(): ProcessManager {
    return this.processManager;
  }

  /**
   * Check if orchestration has started
   */
  get started(): boolean {
    return this.isStarted;
  }

  /**
   * Start a single process
   */
  private async startProcess(name: string): Promise<void> {
    const config = this.configManager.getProcessConfig(name);
    if (!config) {
      throw new Error(`Process '${name}' not found in configuration`);
    }

    this.bootLogger.printProcessStarting(name, 0, config.category ?? 'default');

    await this.processManager.start(name);
  }

  /**
   * Setup event forwarding from ProcessManager
   */
  private setupProcessManagerEvents(): void {
    this.processManager.on('process:starting', (event) => {
      this.emit('process:starting', event);
    });

    this.processManager.on('process:ready', (event) => {
      this.bootLogger.printProcessReady(event.processName);
      this.emit('process:ready', event);
    });

    this.processManager.on('process:status', (event) => {
      this.emit('process:status', event);
    });

    this.processManager.on('process:failed', (event) => {
      this.emit('process:failed', event);
    });

    this.processManager.on('process:stopped', (event) => {
      this.emit('process:stopped', event);
    });

    this.processManager.on('process:restarting', (event) => {
      this.emit('process:restarting', event);
    });
  }
}

