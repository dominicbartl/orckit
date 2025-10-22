/**
 * Preflight check runner
 */

import type { OrckitConfig, PreflightCheckResult } from '@/types';
import { BUILTIN_CHECKS, createPortCheck, createCustomCheck } from './checks.js';

/**
 * Run all preflight checks
 */
export async function runPreflight(config: OrckitConfig): Promise<PreflightCheckResult[]> {
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
      const passed = await check.check();
      const duration = Date.now() - startTime;

      results.push({
        name: check.name,
        passed,
        duration,
        error: passed ? undefined : check.errorMessage,
        fixSuggestion: passed ? undefined : check.fixSuggestion,
      });
    } catch (_error) {
      const duration = Date.now() - startTime;

      results.push({
        name: check.name,
        passed: false,
        duration,
        error: check.errorMessage,
        fixSuggestion: check.fixSuggestion,
      });
    }
  }

  return results;
}
