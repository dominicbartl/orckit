/**
 * Main Orckit orchestrator class - Programmatic API
 */

import { EventEmitter } from 'events';
import type { OrckitConfig, ProcessConfig, ProcessStatus } from '../types/index.js';
import { parseConfig, validateConfig } from './config/parser.js';
import { resolveDependencies } from './dependency/resolver.js';
import { Orchestrator } from './orchestrator.js';
import { createDebugLogger } from '../utils/logger.js';

const debug = createDebugLogger('Orckit');

/**
 * Main Orckit orchestrator - Simplified API wrapper around the full Orchestrator
 */
export class Orckit extends EventEmitter {
  private config: OrckitConfig;
  private processes: Map<string, ProcessStatus> = new Map();
  private startOrder: string[] = [];
  private orchestrator: Orchestrator;

  constructor(options: { configPath?: string; config?: OrckitConfig }) {
    super();

    debug.debug('Initializing Orckit', { options });

    if (options.configPath) {
      debug.debug('Loading config from path', { path: options.configPath });
      this.config = parseConfig(options.configPath);
    } else if (options.config) {
      debug.debug('Validating provided config');
      this.config = validateConfig(options.config);
    } else {
      throw new Error('Either configPath or config must be provided');
    }

    // Resolve dependencies
    this.startOrder = resolveDependencies(this.config);
    debug.info('Dependencies resolved', { startOrder: this.startOrder });

    // Initialize process statuses
    for (const name of this.startOrder) {
      this.processes.set(name, 'pending');
    }

    // Create the orchestrator
    debug.debug('Creating orchestrator');
    this.orchestrator = new Orchestrator({
      config: this.config,
      enableStatusMonitor: true,
      enableTmux: true,
    });

    // Forward orchestrator events
    this.setupEventForwarding();

    debug.info('Orckit initialized successfully');
  }

  /**
   * Setup event forwarding from orchestrator to Orckit
   */
  private setupEventForwarding(): void {
    debug.debug('Setting up event forwarding');

    // Forward process events
    this.orchestrator.on('process:starting', (event) => {
      debug.debug('Process starting', event);
      const name = event.processName;
      this.processes.set(name, 'starting');
      this.emit('process:starting', event);
    });

    this.orchestrator.on('process:ready', (event) => {
      debug.info('Process ready', event);
      const name = event.processName;
      this.processes.set(name, 'running');
      this.emit('process:ready', event);
    });

    this.orchestrator.on('process:status', (event) => {
      debug.debug('Process status changed', event);
      const name = event.processName;
      this.processes.set(name, event.status);
      this.emit('process:status', event);
    });

    this.orchestrator.on('process:failed', (event) => {
      debug.error('Process failed', event);
      const name = event.processName;
      this.processes.set(name, 'failed');
      this.emit('process:failed', event);
    });

    this.orchestrator.on('process:restarting', (event) => {
      debug.warn('Process restarting', event);
      this.emit('process:restarting', event);
    });

    this.orchestrator.on('all:ready', () => {
      debug.info('All processes ready');
      this.emit('all:ready');
    });

    this.orchestrator.on('status:update', (snapshot) => {
      this.emit('status:update', snapshot);
    });

    debug.debug('Event forwarding setup complete');
  }

  /**
   * Start all processes or specific processes
   */
  async start(processNames?: string[]): Promise<void> {
    const startTimer = debug.time('Orckit start');
    debug.info('Starting processes', {
      requested: processNames,
      all: this.startOrder,
    });

    try {
      await this.orchestrator.start(processNames);
      startTimer();
      debug.info('All processes started successfully');
    } catch (error) {
      startTimer();
      debug.error('Failed to start processes', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Stop processes
   */
  async stop(processNames?: string[]): Promise<void> {
    const stopTimer = debug.time('Orckit stop');
    debug.info('Stopping processes', {
      requested: processNames,
      all: this.startOrder,
    });

    try {
      await this.orchestrator.stop(processNames);

      // Update local status tracking
      const toStop = processNames ?? this.startOrder;
      for (const name of toStop) {
        if (this.processes.has(name)) {
          this.processes.set(name, 'stopped');
          this.emit('process:stopped', { processName: name, timestamp: new Date() });
        }
      }

      stopTimer();
      debug.info('Processes stopped successfully');
    } catch (error) {
      stopTimer();
      debug.error('Failed to stop processes', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Restart processes
   */
  async restart(processNames: string[]): Promise<void> {
    const restartTimer = debug.time('Orckit restart');
    debug.info('Restarting processes', { processes: processNames });

    try {
      await this.orchestrator.restart(processNames);
      restartTimer();
      debug.info('Processes restarted successfully');
    } catch (error) {
      restartTimer();
      debug.error('Failed to restart processes', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Get status of all processes or a specific process
   */
  getStatus(processName?: string): ProcessStatus | Map<string, ProcessStatus> {
    if (processName) {
      const status = this.orchestrator.getStatus(processName);
      debug.debug('Getting status for process', { processName, status });
      return status;
    }

    const allStatus = this.orchestrator.getStatus();
    const count = allStatus instanceof Map ? allStatus.size : 0;
    debug.debug('Getting status for all processes', { count });
    return allStatus;
  }

  /**
   * Wait for a process to be ready
   */
  async waitForReady(processName: string, options?: { timeout?: number }): Promise<boolean> {
    const timeout = options?.timeout ?? 30000;
    const startTime = Date.now();

    debug.debug('Waiting for process to be ready', { processName, timeout });

    while (Date.now() - startTime < timeout) {
      const status = this.orchestrator.getStatus(processName);
      if (status === 'running') {
        debug.info('Process is ready', {
          processName,
          elapsed: Date.now() - startTime,
        });
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    debug.warn('Process ready timeout', {
      processName,
      timeout,
      finalStatus: this.orchestrator.getStatus(processName),
    });
    return false;
  }

  /**
   * Add a process dynamically
   */
  addProcess(name: string, config: ProcessConfig): void {
    debug.debug('Adding process dynamically', { name, config });
    this.config.processes[name] = config;
    this.processes.set(name, 'pending');
    // Note: This won't automatically add it to the orchestrator's dependency graph
    // A full restart would be needed to incorporate it
    debug.warn('Dynamic process addition requires restart to incorporate into dependency graph');
  }

  /**
   * Remove a process
   */
  async removeProcess(name: string): Promise<void> {
    debug.info('Removing process', { name });

    try {
      await this.stop([name]);
      delete this.config.processes[name];
      this.processes.delete(name);
      debug.info('Process removed successfully', { name });
    } catch (error) {
      debug.error('Failed to remove process', {
        name,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Get the configuration
   */
  getConfig(): OrckitConfig {
    return this.config;
  }

  /**
   * Get process names
   */
  getProcessNames(): string[] {
    return this.startOrder;
  }

  /**
   * Get the underlying orchestrator (for advanced use cases)
   */
  getOrchestrator(): Orchestrator {
    return this.orchestrator;
  }

  /**
   * Attach to tmux session
   * This will display the overview window and allow switching between process windows
   */
  async attach(): Promise<void> {
    debug.info('Attaching to tmux session');
    try {
      await this.orchestrator.attach();
    } catch (error) {
      debug.error('Failed to attach to tmux session', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }
}
