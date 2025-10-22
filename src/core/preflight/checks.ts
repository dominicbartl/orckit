/**
 * Preflight check system
 */

import { execa } from 'execa';
import {
  isDockerRunning,
  isTmuxAvailable,
  getNodeVersion,
  isPortAvailable,
} from '../../utils/system.js';
import type { OrckitConfig, PreflightCheckResult } from '../../types/index.js';
import { extractPorts, hasDockerProcesses } from '../config/parser.js';

/**
 * Preflight check function
 */
export interface PreflightCheck {
  name: string;
  check: () => Promise<boolean>;
  errorMessage: string;
  fixSuggestion?: string;
  conditional?: (config: OrckitConfig) => boolean;
}

/**
 * Built-in preflight checks
 */
export const BUILTIN_CHECKS: PreflightCheck[] = [
  {
    name: 'tmux',
    check: async () => await isTmuxAvailable(),
    errorMessage: 'tmux is not installed',
    fixSuggestion: 'Install with: brew install tmux (macOS) or apt-get install tmux (Linux)',
  },
  {
    name: 'docker_daemon',
    check: async () => await isDockerRunning(),
    errorMessage: 'Docker daemon is not running',
    fixSuggestion: 'Start Docker Desktop or run: sudo systemctl start docker',
    conditional: (config) => hasDockerProcesses(config),
  },
  {
    name: 'node_version',
    check: async () => {
      const version = getNodeVersion();
      return version.major >= 18;
    },
    errorMessage: 'Node.js version must be >= 18',
    fixSuggestion: 'Upgrade Node.js: https://nodejs.org',
  },
];

/**
 * Create port availability check
 */
export function createPortCheck(config: OrckitConfig): PreflightCheck {
  return {
    name: 'port_availability',
    check: async () => {
      const ports = extractPorts(config);

      for (const port of ports) {
        const available = await isPortAvailable(port);
        if (!available) {
          return false;
        }
      }

      return true;
    },
    errorMessage: 'Required ports are already in use',
    fixSuggestion: 'Stop conflicting processes or update port configuration',
  };
}

/**
 * Create custom preflight check from config
 */
export function createCustomCheck(
  name: string,
  command: string,
  error: string,
  fix?: string
): PreflightCheck {
  return {
    name,
    check: async () => {
      try {
        const result = await execa('bash', ['-c', command], {
          timeout: 10000,
          reject: false,
        });
        return result.exitCode === 0;
      } catch {
        return false;
      }
    },
    errorMessage: error,
    fixSuggestion: fix,
  };
}

/**
 * Run all preflight checks
 *
 * @param config - Orckit configuration
 * @param onCheckStart - Callback when check starts
 * @param onCheckComplete - Callback when check completes
 * @returns Array of check results
 */
export async function runPreflightChecks(
  config: OrckitConfig,
  onCheckStart?: (name: string) => void,
  onCheckComplete?: (result: PreflightCheckResult) => void
): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];

  // Built-in checks
  const checksToRun = BUILTIN_CHECKS.filter(
    (check) => !check.conditional || check.conditional(config)
  );

  // Add port check
  checksToRun.push(createPortCheck(config));

  // Add custom checks from config
  if (config.preflight?.checks) {
    for (const customCheck of config.preflight.checks) {
      checksToRun.push(
        createCustomCheck(customCheck.name, customCheck.command, customCheck.error, customCheck.fix)
      );
    }
  }

  // Run all checks
  for (const check of checksToRun) {
    if (onCheckStart) {
      onCheckStart(check.name);
    }

    const startTime = Date.now();
    const passed = await check.check();
    const duration = Date.now() - startTime;

    const result: PreflightCheckResult = {
      name: check.name,
      passed,
      duration,
      error: passed ? undefined : check.errorMessage,
      fixSuggestion: passed ? undefined : check.fixSuggestion,
    };

    results.push(result);

    if (onCheckComplete) {
      onCheckComplete(result);
    }
  }

  return results;
}

/**
 * Check if all preflight checks passed
 */
export function allChecksPassed(results: PreflightCheckResult[]): boolean {
  return results.every((r) => r.passed);
}

/**
 * Get failed checks
 */
export function getFailedChecks(results: PreflightCheckResult[]): PreflightCheckResult[] {
  return results.filter((r) => !r.passed);
}
