/**
 * Dependency resolver using topological sorting
 */

import type { OrckitConfig } from '../../types/index.js';

/**
 * Error thrown when a circular dependency is detected
 */
export class CircularDependencyError extends Error {
  constructor(
    message: string,
    public cycle: string[]
  ) {
    super(message);
    this.name = 'CircularDependencyError';
  }
}

/**
 * Error thrown when a dependency is missing
 */
export class MissingDependencyError extends Error {
  constructor(
    message: string,
    public process: string,
    public missingDependency: string
  ) {
    super(message);
    this.name = 'MissingDependencyError';
  }
}

/**
 * Resolve dependencies and return processes in startup order
 * Uses topological sorting (Kahn's algorithm)
 *
 * @param config - Orckit configuration
 * @returns Array of process names in the order they should be started
 * @throws {CircularDependencyError} If circular dependencies are detected
 * @throws {MissingDependencyError} If a referenced dependency doesn't exist
 */
export function resolveDependencies(config: OrckitConfig): string[] {
  const processes = config.processes;
  const processNames = Object.keys(processes);

  // Validate that all dependencies exist
  for (const [name, processConfig] of Object.entries(processes)) {
    for (const dep of processConfig.dependencies || []) {
      if (!processes[dep]) {
        throw new MissingDependencyError(
          `Process '${name}' depends on '${dep}' which doesn't exist`,
          name,
          dep
        );
      }
    }
  }

  // Build in-degree map (how many dependencies each process has)
  const inDegree = new Map<string, number>();
  for (const name of processNames) {
    inDegree.set(name, (processes[name].dependencies || []).length);
  }

  // Build adjacency list (which processes depend on each process)
  const dependents = new Map<string, string[]>();
  for (const name of processNames) {
    dependents.set(name, []);
  }

  for (const [name, processConfig] of Object.entries(processes)) {
    for (const dep of processConfig.dependencies || []) {
      dependents.get(dep)!.push(name);
    }
  }

  // Topological sort using Kahn's algorithm
  const result: string[] = [];
  const queue: string[] = [];

  // Start with processes that have no dependencies
  for (const [name, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(name);
    }
  }

  while (queue.length > 0) {
    // Sort queue to ensure deterministic order when multiple processes have same priority
    queue.sort();

    const current = queue.shift()!;
    result.push(current);

    // Reduce in-degree for all dependents
    for (const dependent of dependents.get(current) || []) {
      const newDegree = inDegree.get(dependent)! - 1;
      inDegree.set(dependent, newDegree);

      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // If not all processes are in result, there's a circular dependency
  if (result.length !== processNames.length) {
    const remaining = processNames.filter((n) => !result.includes(n));
    const cycle = findCycle(processes, remaining);

    throw new CircularDependencyError(`Circular dependency detected: ${cycle.join(' -> ')}`, cycle);
  }

  return result;
}

/**
 * Find a cycle in the dependency graph
 *
 * @param processes - Process configurations
 * @param remaining - Processes not yet resolved
 * @returns Array representing the cycle
 */
function findCycle(processes: OrckitConfig['processes'], remaining: string[]): string[] {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): boolean {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    for (const dep of processes[node].dependencies || []) {
      if (!visited.has(dep)) {
        if (dfs(dep)) {
          return true;
        }
      } else if (recursionStack.has(dep)) {
        // Found cycle
        return true;
      }
    }

    recursionStack.delete(node);
    path.pop();
    return false;
  }

  for (const node of remaining) {
    if (!visited.has(node)) {
      if (dfs(node)) {
        // Extract the cycle from path
        return [...path];
      }
    }
  }

  return remaining; // Fallback
}

/**
 * Group processes into waves based on dependencies
 * Processes in the same wave can be started in parallel
 *
 * @param config - Orckit configuration
 * @returns Array of arrays, where each inner array is a wave of processes that can start together
 */
export function groupIntoWaves(config: OrckitConfig): string[][] {
  const ordered = resolveDependencies(config);
  const processes = config.processes;
  const waves: string[][] = [];
  const startedProcesses = new Set<string>();

  for (const processName of ordered) {
    const deps = processes[processName].dependencies || [];

    // Check if all dependencies have been started
    const canStart = deps.every((dep) => startedProcesses.has(dep));

    if (canStart) {
      // Find which wave this process belongs to
      // It belongs to the wave right after its dependencies' wave
      let waveIndex = 0;

      if (deps.length > 0) {
        for (let i = 0; i < waves.length; i++) {
          if (deps.some((dep) => waves[i].includes(dep))) {
            waveIndex = i + 1;
          }
        }
      }

      // Ensure wave exists
      while (waves.length <= waveIndex) {
        waves.push([]);
      }

      waves[waveIndex].push(processName);
      startedProcesses.add(processName);
    }
  }

  return waves;
}

/**
 * Get all dependencies of a process (direct and transitive)
 *
 * @param config - Orckit configuration
 * @param processName - Name of the process
 * @returns Set of all dependency names
 */
export function getAllDependencies(config: OrckitConfig, processName: string): Set<string> {
  const allDeps = new Set<string>();
  const processes = config.processes;

  function collectDeps(name: string) {
    const deps = processes[name]?.dependencies || [];

    for (const dep of deps) {
      if (!allDeps.has(dep)) {
        allDeps.add(dep);
        collectDeps(dep);
      }
    }
  }

  collectDeps(processName);
  return allDeps;
}

/**
 * Get all processes that depend on a given process
 *
 * @param config - Orckit configuration
 * @param processName - Name of the process
 * @returns Set of process names that depend on the given process
 */
export function getDependents(config: OrckitConfig, processName: string): Set<string> {
  const dependents = new Set<string>();

  for (const [name, processConfig] of Object.entries(config.processes)) {
    if (processConfig.dependencies?.includes(processName)) {
      dependents.add(name);
    }
  }

  return dependents;
}

/**
 * Visualize the dependency graph as a simple text representation
 *
 * @param config - Orckit configuration
 * @returns String representation of the dependency graph
 */
export function visualizeDependencyGraph(config: OrckitConfig): string {
  const lines: string[] = [];
  const processes = config.processes;

  // Build adjacency information
  const dependencyMap = new Map<string, string[]>();

  for (const [name, processConfig] of Object.entries(processes)) {
    dependencyMap.set(name, processConfig.dependencies || []);
  }

  // Simple visualization
  for (const [name, deps] of dependencyMap.entries()) {
    if (deps.length === 0) {
      lines.push(`${name}`);
    } else {
      lines.push(`${deps.join(', ')} → ${name}`);
    }
  }

  return lines.join('\n');
}
