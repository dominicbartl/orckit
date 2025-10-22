/**
 * Configuration parser for Orckit
 */

import { readFileSync } from 'fs';
import { load as parseYaml } from 'js-yaml';
import { orckitConfigSchema } from './schema.js';
import type { OrckitConfig } from '../../types/index.js';

/**
 * Parse and validate Orckit configuration from YAML file
 *
 * @param configPath - Path to the configuration file
 * @returns Validated configuration object
 * @throws Error if file cannot be read or validation fails
 */
export function parseConfig(configPath: string): OrckitConfig {
  try {
    // Read file
    const fileContent = readFileSync(configPath, 'utf-8');

    // Parse YAML
    const rawConfig = parseYaml(fileContent);

    // Validate with Zod
    const validatedConfig = orckitConfigSchema.parse(rawConfig);

    return validatedConfig as OrckitConfig;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse config file '${configPath}': ${error.message}`);
    }
    throw error;
  }
}

/**
 * Validate configuration object (for programmatic usage)
 *
 * @param config - Configuration object to validate
 * @returns Validated configuration object
 * @throws Error if validation fails
 */
export function validateConfig(config: unknown): OrckitConfig {
  try {
    const validatedConfig = orckitConfigSchema.parse(config);
    return validatedConfig as OrckitConfig;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Configuration validation failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Parse time duration string to milliseconds
 * Supports: "5s", "10m", "1h", "500ms"
 *
 * @param duration - Duration string
 * @returns Duration in milliseconds
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);

  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use format like "5s", "10m", "1h"`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'ms':
      return value;
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown time unit: ${unit}`);
  }
}

/**
 * Extract port numbers from a process configuration
 *
 * @param config - Process configuration
 * @returns Array of port numbers
 */
export function extractPorts(config: OrckitConfig): number[] {
  const ports: number[] = [];

  for (const processConfig of Object.values(config.processes)) {
    // Extract from ready check
    if (processConfig.ready) {
      if (processConfig.ready.type === 'tcp') {
        ports.push(processConfig.ready.port);
      } else if (processConfig.ready.type === 'http') {
        try {
          const url = new URL(processConfig.ready.url);
          if (url.port) {
            ports.push(parseInt(url.port, 10));
          }
        } catch {
          // Invalid URL, skip
        }
      }
    }

    // Extract from command (simple heuristic)
    const portMatches = processConfig.command.matchAll(/:(\d{2,5})\b/g);
    for (const match of portMatches) {
      const port = parseInt(match[1], 10);
      if (port >= 1 && port <= 65535) {
        ports.push(port);
      }
    }

    // Extract from docker command -p flags
    if (processConfig.type === 'docker') {
      const dockerPortMatches = processConfig.command.matchAll(/-p\s+(\d+):/g);
      for (const match of dockerPortMatches) {
        ports.push(parseInt(match[1], 10));
      }
    }
  }

  return [...new Set(ports)]; // Remove duplicates
}

/**
 * Check if configuration uses Docker processes
 *
 * @param config - Orckit configuration
 * @returns True if any process uses Docker
 */
export function hasDockerProcesses(config: OrckitConfig): boolean {
  return Object.values(config.processes).some((p) => p.type === 'docker');
}

/**
 * Get all process names from configuration
 *
 * @param config - Orckit configuration
 * @returns Array of process names
 */
export function getProcessNames(config: OrckitConfig): string[] {
  return Object.keys(config.processes);
}

/**
 * Get processes by category
 *
 * @param config - Orckit configuration
 * @param category - Category name
 * @returns Map of process name to config for the category
 */
export function getProcessesByCategory(
  config: OrckitConfig,
  category: string
): Record<string, OrckitConfig['processes'][string]> {
  const processes: Record<string, OrckitConfig['processes'][string]> = {};

  for (const [name, processConfig] of Object.entries(config.processes)) {
    if (processConfig.category === category) {
      processes[name] = processConfig;
    }
  }

  return processes;
}

/**
 * Get all unique categories from configuration
 *
 * @param config - Orckit configuration
 * @returns Array of unique category names
 */
export function getCategories(config: OrckitConfig): string[] {
  const categories = new Set<string>();

  for (const processConfig of Object.values(config.processes)) {
    categories.add(processConfig.category);
  }

  return [...categories];
}
