/**
 * Preflight check system
 */

import { execa } from 'execa';
import {
  isDockerRunning,
  isTmuxAvailable,
  getNodeVersion,
} from '../../utils/system.js';
import type { OrckitConfig, PreflightCheckResult } from '../../types/index.js';
import { extractPorts, hasDockerProcesses } from '../config/parser.js';
import { checkPorts, formatPortConflictMessage } from '../../utils/port.js';
import { createDebugLogger } from '../../utils/logger.js';

const debug = createDebugLogger('PreflightChecks');

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
 * Create port availability check with detailed conflict information
 */
export function createPortCheck(config: OrckitConfig): PreflightCheck {
  let conflictDetails: string | undefined;

  return {
    name: 'port_availability',
    check: async () => {
      const ports = extractPorts(config);

      if (ports.length === 0) {
        debug.debug('No ports found in configuration');
        return true;
      }

      debug.info('Checking port availability', { ports });

      const conflicts = await checkPorts(ports);

      if (conflicts.length === 0) {
        debug.info('All ports are available', { ports });
        return true;
      }

      // Build detailed error message with process information
      debug.warn('Port conflicts detected', {
        count: conflicts.length,
        ports: conflicts.map((c) => c.port),
      });

      const conflictMessages = conflicts.map((conflict) => {
        if (conflict.user) {
          return formatPortConflictMessage(conflict.port, conflict.user);
        } else {
          return `Port ${conflict.port} is already in use by another process`;
        }
      });

      conflictDetails = conflictMessages.join('\n\n---\n\n');

      return false;
    },
    get errorMessage() {
      if (conflictDetails) {
        return `Port conflicts detected:\n\n${conflictDetails}`;
      }
      return 'Required ports are already in use';
    },
    fixSuggestion:
      'Stop the conflicting processes or update your configuration to use different ports',
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
