import { describe, expect, it } from 'vitest';
import {
  buildGraph,
  DependencyError,
  filterToTargets,
  groupIntoWaves,
  resolveStartOrder,
  transitiveDependencies,
  transitiveDependents,
  visualize,
} from '../../src/graph/resolver.js';
import type { OrckitConfig } from '../../src/config/schema.js';

function configWith(processes: Record<string, string[]>): OrckitConfig {
  const config: OrckitConfig = {
    project: 't',
    processes: {} as Record<string, never>,
    preflight: [],
  };
  for (const [name, deps] of Object.entries(processes)) {
    (config.processes as Record<string, unknown>)[name] = {
      command: 'echo',
      type: 'bash',
      category: 'default',
      env: {},
      depends_on: deps,
      restart: 'on-failure',
      restart_delay_ms: 2000,
      max_retries: 3,
      buffer_size: 1000,
    };
  }
  return config;
}

describe('buildGraph', () => {
  it('builds adjacency from depends_on', () => {
    const graph = buildGraph(configWith({ a: [], b: ['a'] }));
    expect([...graph.get('b')!]).toEqual(['a']);
  });

  it('throws on unknown dependency', () => {
    expect(() => buildGraph(configWith({ a: ['ghost'] }))).toThrow(DependencyError);
  });
});

describe('resolveStartOrder', () => {
  it('returns deterministic order for independent nodes', () => {
    const graph = buildGraph(configWith({ c: [], a: [], b: [] }));
    expect(resolveStartOrder(graph)).toEqual(['a', 'b', 'c']);
  });

  it('respects dependencies', () => {
    const graph = buildGraph(configWith({ frontend: ['api'], api: ['db'], db: [] }));
    expect(resolveStartOrder(graph)).toEqual(['db', 'api', 'frontend']);
  });

  it('detects cycles', () => {
    const graph = buildGraph(configWith({ a: ['b'], b: ['a'] }));
    expect(() => resolveStartOrder(graph)).toThrow(/circular/);
  });

  it('detects self-cycles', () => {
    const graph = buildGraph(configWith({ a: ['a'] }));
    expect(() => resolveStartOrder(graph)).toThrow(/circular/);
  });
});

describe('groupIntoWaves', () => {
  it('puts independent processes in wave 0', () => {
    const graph = buildGraph(configWith({ a: [], b: [], c: [] }));
    expect(groupIntoWaves(graph)).toEqual([['a', 'b', 'c']]);
  });

  it('groups by maximum depth', () => {
    const graph = buildGraph(
      configWith({
        db: [],
        cache: [],
        api: ['db', 'cache'],
        worker: ['db'],
        ui: ['api'],
      }),
    );
    expect(groupIntoWaves(graph)).toEqual([['cache', 'db'], ['api', 'worker'], ['ui']]);
  });
});

describe('transitiveDependencies', () => {
  it('returns all upstream deps', () => {
    const graph = buildGraph(configWith({ a: [], b: ['a'], c: ['b'], d: ['c'] }));
    expect([...transitiveDependencies(graph, 'd')].sort()).toEqual(['a', 'b', 'c']);
  });

  it('rejects unknown processes', () => {
    const graph = buildGraph(configWith({ a: [] }));
    expect(() => transitiveDependencies(graph, 'ghost')).toThrow(DependencyError);
  });
});

describe('transitiveDependents', () => {
  it('returns all downstream nodes', () => {
    const graph = buildGraph(configWith({ a: [], b: ['a'], c: ['b'], d: ['c'] }));
    expect([...transitiveDependents(graph, 'a')].sort()).toEqual(['b', 'c', 'd']);
  });

  it('returns empty set for leaf nodes', () => {
    const graph = buildGraph(configWith({ a: [], b: ['a'] }));
    expect([...transitiveDependents(graph, 'b')]).toEqual([]);
  });

  it('handles branching dependencies', () => {
    const graph = buildGraph(configWith({ db: [], api: ['db'], worker: ['db'], web: ['api'] }));
    expect([...transitiveDependents(graph, 'db')].sort()).toEqual(['api', 'web', 'worker']);
  });

  it('rejects unknown processes', () => {
    const graph = buildGraph(configWith({ a: [] }));
    expect(() => transitiveDependents(graph, 'ghost')).toThrow(DependencyError);
  });
});

describe('filterToTargets', () => {
  it('pulls in dependencies of targeted processes', () => {
    const graph = buildGraph(configWith({ a: [], b: ['a'], c: [] }));
    expect([...filterToTargets(graph, ['b'])].sort()).toEqual(['a', 'b']);
  });

  it('does not include unrelated processes', () => {
    const graph = buildGraph(configWith({ a: [], b: ['a'], c: [] }));
    expect([...filterToTargets(graph, ['c'])]).toEqual(['c']);
  });

  it('rejects unknown targets', () => {
    const graph = buildGraph(configWith({ a: [] }));
    expect(() => filterToTargets(graph, ['nope'])).toThrow(DependencyError);
  });
});

describe('visualize', () => {
  it('renders a readable graph', () => {
    const graph = buildGraph(configWith({ a: [], b: ['a'] }));
    expect(visualize(graph)).toBe('a\nb  ← a');
  });
});
