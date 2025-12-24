/**
 * Configuration Manager
 *
 * Single source of truth for configuration handling:
 * - Loading from file or object
 * - Validation via Zod schemas
 * - Dependency resolution (start order and wave grouping)
 *
 * This manager is stateless after initialization and can be tested independently.
 */

import type { OrckitConfig, ProcessConfig } from '../../types/index.js';
import { parseConfig, validateConfig } from './parser.js';
import {
  resolveDependencies,
  groupIntoWaves,
  getAllDependencies,
  visualizeDependencyGraph,
} from '../dependency/resolver.js';

/**
 * Options for creating a ConfigManager
 */
export interface ConfigManagerOptions {
  /**
   * Path to configuration file (YAML)
   */
  configPath?: string;

  /**
   * Configuration object (alternative to configPath)
   */
  config?: OrckitConfig;
}

/**
 * Resolved dependency information
 */
export interface DependencyInfo {
  /**
   * Processes in topologically sorted order (respects dependencies)
   */
  startOrder: string[];

  /**
   * Processes grouped into waves for parallel startup
   * Each wave can be started in parallel; waves must be sequential
   */
  waves: string[][];
}

/**
 * Configuration Manager - handles all config-related operations
 *
 * @example
 * ```ts
 * // From file
 * const configManager = new ConfigManager({ configPath: './orckit.yaml' });
 *
 * // From object
 * const configManager = new ConfigManager({ config: myConfig });
 *
 * // Access resolved data
 * const config = configManager.getConfig();
 * const startOrder = configManager.getStartOrder();
 * const waves = configManager.getWaves();
 * ```
 */
export class ConfigManager {
  private readonly config: OrckitConfig;
  private readonly dependencyInfo: DependencyInfo;

  constructor(options: ConfigManagerOptions) {
    // Load and validate config
    if (options.configPath) {
      this.config = parseConfig(options.configPath);
    } else if (options.config) {
      this.config = validateConfig(options.config);
    } else {
      throw new Error('ConfigManager requires either configPath or config');
    }

    // Resolve dependencies once at construction
    this.dependencyInfo = {
      startOrder: resolveDependencies(this.config),
      waves: groupIntoWaves(this.config),
    };
  }

  /**
   * Get the validated configuration
   */
  getConfig(): OrckitConfig {
    return this.config;
  }

  /**
   * Get the project name
   */
  getProjectName(): string {
    return this.config.project ?? 'orckit';
  }

  /**
   * Get process names in dependency-resolved order
   */
  getStartOrder(): string[] {
    return this.dependencyInfo.startOrder;
  }

  /**
   * Get processes grouped into parallel waves
   */
  getWaves(): string[][] {
    return this.dependencyInfo.waves;
  }

  /**
   * Get configuration for a specific process
   */
  getProcessConfig(name: string): ProcessConfig | undefined {
    return this.config.processes[name];
  }

  /**
   * Get all process names
   */
  getProcessNames(): string[] {
    return Object.keys(this.config.processes);
  }

  /**
   * Check if a process exists
   */
  hasProcess(name: string): boolean {
    return name in this.config.processes;
  }

  /**
   * Get all dependencies for a process (transitive)
   */
  getDependencies(processName: string): string[] {
    return Array.from(getAllDependencies(this.config, processName));
  }

  /**
   * Get ASCII visualization of the dependency graph
   */
  getDependencyGraph(): string {
    return visualizeDependencyGraph(this.config);
  }

  /**
   * Get category for a process
   */
  getProcessCategory(name: string): string {
    return this.config.processes[name]?.category ?? 'default';
  }

  /**
   * Get boot configuration
   */
  getBootConfig() {
    return this.config.maestro?.boot;
  }

  /**
   * Get preflight configuration
   */
  getPreflightConfig() {
    return this.config.preflight;
  }

  /**
   * Get global hooks configuration
   */
  getGlobalHooks() {
    return this.config.hooks;
  }

  /**
   * Filter start order to only include specified processes and their dependencies
   */
  filterStartOrder(processNames?: string[]): string[] {
    if (!processNames || processNames.length === 0) {
      return this.dependencyInfo.startOrder;
    }

    // Collect all required processes (including dependencies)
    const required = new Set<string>();
    for (const name of processNames) {
      if (!this.hasProcess(name)) {
        throw new Error(`Unknown process: ${name}`);
      }
      required.add(name);
      for (const dep of this.getDependencies(name)) {
        required.add(dep);
      }
    }

    // Return in dependency order
    return this.dependencyInfo.startOrder.filter((name) => required.has(name));
  }

  /**
   * Filter waves to only include specified processes
   */
  filterWaves(processNames?: string[]): string[][] {
    if (!processNames || processNames.length === 0) {
      return this.dependencyInfo.waves;
    }

    const required = new Set(this.filterStartOrder(processNames));

    return this.dependencyInfo.waves
      .map((wave) => wave.filter((name) => required.has(name)))
      .filter((wave) => wave.length > 0);
  }
}
