import type { OrckitConfig } from '../config/schema.js';

export class DependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DependencyError';
  }
}

export type DependencyGraph = ReadonlyMap<string, readonly string[]>;

export function buildGraph(config: OrckitConfig): DependencyGraph {
  const graph = new Map<string, readonly string[]>();
  for (const [name, process] of Object.entries(config.processes)) {
    for (const dep of process.depends_on) {
      if (!(dep in config.processes)) {
        throw new DependencyError(`process "${name}" depends on unknown process "${dep}"`);
      }
    }
    graph.set(name, process.depends_on);
  }
  return graph;
}

export function resolveStartOrder(graph: DependencyGraph): string[] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const name of graph.keys()) {
    inDegree.set(name, 0);
    dependents.set(name, []);
  }
  for (const [name, deps] of graph) {
    inDegree.set(name, deps.length);
    for (const dep of deps) {
      dependents.get(dep)!.push(name);
    }
  }

  const ready = [...inDegree.entries()]
    .filter(([, d]) => d === 0)
    .map(([n]) => n)
    .sort();
  const order: string[] = [];

  while (ready.length > 0) {
    const next = ready.shift()!;
    order.push(next);
    for (const child of dependents.get(next)!) {
      const remaining = inDegree.get(child)! - 1;
      inDegree.set(child, remaining);
      if (remaining === 0) {
        ready.push(child);
        ready.sort();
      }
    }
  }

  if (order.length !== graph.size) {
    const stuck = [...inDegree.entries()].filter(([, d]) => d > 0).map(([n]) => n);
    throw new DependencyError(`circular dependency detected involving: ${stuck.join(', ')}`);
  }

  return order;
}

export function groupIntoWaves(graph: DependencyGraph): string[][] {
  const order = resolveStartOrder(graph);
  const waveOf = new Map<string, number>();
  for (const name of order) {
    const deps = graph.get(name)!;
    const wave = deps.length === 0 ? 0 : Math.max(...deps.map((d) => waveOf.get(d)! + 1));
    waveOf.set(name, wave);
  }
  const waves: string[][] = [];
  for (const [name, wave] of waveOf) {
    (waves[wave] ??= []).push(name);
  }
  return waves.map((w) => w.sort());
}

export function transitiveDependencies(graph: DependencyGraph, name: string): Set<string> {
  if (!graph.has(name)) {
    throw new DependencyError(`unknown process "${name}"`);
  }
  const visited = new Set<string>();
  const stack = [...graph.get(name)!];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(graph.get(current) ?? []));
  }
  return visited;
}

export function filterToTargets(graph: DependencyGraph, targets: string[]): Set<string> {
  const required = new Set<string>();
  for (const name of targets) {
    if (!graph.has(name)) {
      throw new DependencyError(`unknown process "${name}"`);
    }
    required.add(name);
    for (const dep of transitiveDependencies(graph, name)) {
      required.add(dep);
    }
  }
  return required;
}

export function visualize(graph: DependencyGraph): string {
  const order = resolveStartOrder(graph);
  const lines: string[] = [];
  for (const name of order) {
    const deps = graph.get(name)!;
    if (deps.length === 0) {
      lines.push(name);
    } else {
      lines.push(`${name}  ← ${deps.join(', ')}`);
    }
  }
  return lines.join('\n');
}
