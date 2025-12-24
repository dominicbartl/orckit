/**
 * Preflight check runner
 */

import type { OrckitConfig, PreflightCheckResult } from '@/types';
import { BUILTIN_CHECKS, createPortCheck, createCustomCheck } from './checks.js';

/**
 * Run all preflight checks
 * @param config - Orckit configuration
 * @param interactive - If true, prompt user to resolve failures interactively
 */
export async function runPreflight(
  config: OrckitConfig,
  interactive: boolean = true
): Promise<PreflightCheckResult[]> {
  const results: PreflightCheckResult[] = [];

  // Collect all checks to run
  const checks = [...BUILTIN_CHECKS];

  // Add port availability check
  checks.push(createPortCheck(config));

  // Add custom checks from config
  if (config.preflight?.checks) {
    for (const customCheck of config.preflight.checks) {
      checks.push(
        createCustomCheck(customCheck.name, customCheck.command, customCheck.error, customCheck.fix)
      );
    }
  }

  // Run each check
  for (const check of checks) {
    // Skip conditional checks
    if (check.conditional && !check.conditional(config)) {
      continue;
    }

    const startTime = Date.now();

    try {
      let passed = await check.check();
      let duration = Date.now() - startTime;

      // If check failed and has interactive handler, try to resolve
      if (!passed && interactive && check.interactive) {
        const resolved = await check.interactive();

        if (resolved) {
          // Re-run the check to verify it's fixed
          const recheckStart = Date.now();
          passed = await check.check();
          duration = Date.now() - recheckStart;
        } else {
          // User chose not to resolve or resolution failed
          // Mark as failed and abort
          results.push({
            name: check.name,
            passed: false,
            duration,
            error: 'User cancelled or resolution failed',
            fixSuggestion: check.fixSuggestion,
          });

          // Return early - don't run remaining checks
          return results;
        }
      }

      results.push({
        name: check.name,
        passed,
        duration,
        error: passed ? undefined : check.errorMessage,
        fixSuggestion: passed ? undefined : check.fixSuggestion,
      });

      // If check still failed after interactive resolution, abort
      if (!passed) {
        return results;
      }
    } catch (_error) {
      const duration = Date.now() - startTime;

      results.push({
        name: check.name,
        passed: false,
        duration,
        error: check.errorMessage,
        fixSuggestion: check.fixSuggestion,
      });

      // Abort on error
      return results;
    }
  }

  return results;
}
