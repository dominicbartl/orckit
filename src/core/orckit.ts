/**
 * Main Orckit orchestrator class - Programmatic API
 */

import { EventEmitter } from 'events';
import type { OrckitConfig, ProcessConfig, ProcessStatus } from '../types/index.js';
import { parseConfig, validateConfig } from './config/parser.js';
import { resolveDependencies } from './dependency/resolver.js';

/**
 * Main Orckit orchestrator
 */
export class Orckit extends EventEmitter {
  private config: OrckitConfig;
  private processes: Map<string, ProcessStatus> = new Map();
  private startOrder: string[] = [];

  constructor(options: { configPath?: string; config?: OrckitConfig }) {
    super();

    if (options.configPath) {
      this.config = parseConfig(options.configPath);
    } else if (options.config) {
      this.config = validateConfig(options.config);
    } else {
      throw new Error('Either configPath or config must be provided');
    }

    // Resolve dependencies
    this.startOrder = resolveDependencies(this.config);

    // Initialize process statuses
    for (const name of this.startOrder) {
      this.processes.set(name, 'pending');
    }
  }

  /**
   * Start all processes or specific processes
   */
  async start(processNames?: string[]): Promise<void> {
    const toStart = processNames ?? this.startOrder;

    for (const name of toStart) {
      if (!this.config.processes[name]) {
        throw new Error(`Process '${name}' not found in configuration`);
      }

      this.emit('process:starting', { processName: name, timestamp: new Date() });
      this.processes.set(name, 'starting');

      // Simulate process start (placeholder)
      await new Promise((resolve) => setTimeout(resolve, 100));

      this.processes.set(name, 'running');
      this.emit('process:ready', {
        processName: name,
        timestamp: new Date(),
        duration: 100,
      });
    }

    this.emit('all:ready');
  }

  /**
   * Stop processes
   */
  async stop(processNames?: string[]): Promise<void> {
    const toStop = processNames ?? [...this.startOrder].reverse();

    for (const name of toStop) {
      if (this.processes.get(name) === 'running') {
        this.processes.set(name, 'stopped');
        this.emit('process:stopped', { processName: name, timestamp: new Date() });
      }
    }

    await Promise.resolve(); // Make it actually async
  }

  /**
   * Restart processes
   */
  async restart(processNames: string[]): Promise<void> {
    await this.stop(processNames);
    await this.start(processNames);
  }

  /**
   * Get status of all processes or a specific process
   */
  getStatus(processName?: string): ProcessStatus | Map<string, ProcessStatus> {
    if (processName) {
      return this.processes.get(processName) ?? 'pending';
    }
    return new Map(this.processes);
  }

  /**
   * Wait for a process to be ready
   */
  async waitForReady(processName: string, options?: { timeout?: number }): Promise<boolean> {
    const timeout = options?.timeout ?? 30000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (this.processes.get(processName) === 'running') {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return false;
  }

  /**
   * Add a process dynamically
   */
  addProcess(name: string, config: ProcessConfig): void {
    this.config.processes[name] = config;
    this.processes.set(name, 'pending');
  }

  /**
   * Remove a process
   */
  async removeProcess(name: string): Promise<void> {
    await this.stop([name]);
    delete this.config.processes[name];
    this.processes.delete(name);
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
}
