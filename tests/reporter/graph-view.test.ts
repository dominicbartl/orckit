import { describe, expect, it } from 'vitest';
import { renderGraph } from '../../src/reporter/graph-view.js';
import { buildGraph } from '../../src/graph/resolver.js';
import { stripAnsi } from '../../src/process/parsers.js';
import type { OrckitConfig } from '../../src/config/schema.js';
import type { ProcessState } from '../../src/orchestrator/lifecycle.js';

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

describe('renderGraph', () => {
  it('groups processes into waves separated by tree-style connectors', () => {
    const graph = buildGraph(configWith({ db: [], api: ['db'], web: ['api'], worker: ['api'] }));
    expect(stripAnsi(renderGraph(graph))).toBe(
      [
        '┌─ Wave 1 ─── starts immediately',
        '│  ○ db',
        '│',
        '├─ Wave 2 ─── after wave 1',
        '│  ○ api     ← db',
        '│',
        '└─ Wave 3 ─── after wave 2 (2 in parallel)',
        '   ○ web     ← api',
        '   ○ worker  ← api',
      ].join('\n'),
    );
  });

  it('marks parallel waves with an "N in parallel" hint', () => {
    const graph = buildGraph(configWith({ a: [], b: [], c: [] }));
    expect(stripAnsi(renderGraph(graph))).toContain('(3 in parallel)');
  });

  it('drops the tree connector for single-wave graphs', () => {
    const graph = buildGraph(configWith({ a: [] }));
    const out = stripAnsi(renderGraph(graph));
    expect(out).toContain('── Wave 1 ───');
    expect(out).not.toContain('│');
    expect(out).not.toContain('└');
  });

  it('renders process icons based on the provided state map', () => {
    const graph = buildGraph(configWith({ db: [], api: ['db'] }));
    const states = new Map<string, ProcessState>([
      ['db', 'ready'],
      ['api', 'starting'],
    ]);
    const out = stripAnsi(renderGraph(graph, { states }));
    expect(out).toContain('✓ db');
    expect(out).toContain('⠋ api');
  });

  it('falls back to pending icons for processes missing from the state map', () => {
    const graph = buildGraph(configWith({ db: [], api: ['db'] }));
    const out = stripAnsi(renderGraph(graph, { states: new Map([['db', 'ready']]) }));
    expect(out).toContain('✓ db');
    expect(out).toContain('○ api');
  });

  it('cycles spinner frames for starting processes based on spinnerFrame', () => {
    const graph = buildGraph(configWith({ db: [] }));
    const states = new Map<string, ProcessState>([['db', 'starting']]);
    const frame0 = stripAnsi(renderGraph(graph, { states, spinnerFrame: 0 }));
    const frame1 = stripAnsi(renderGraph(graph, { states, spinnerFrame: 1 }));
    expect(frame0).toContain('⠋ db');
    expect(frame1).toContain('⠙ db');
  });

  it('appends per-row annotations after the dependency arrow', () => {
    const graph = buildGraph(configWith({ db: [], api: ['db'] }));
    const annotations = new Map([
      ['db', '(132ms)'],
      ['api', '(840ms)'],
    ]);
    const out = stripAnsi(renderGraph(graph, { annotations }));
    expect(out).toContain('○ db   (132ms)'); // db padded to width 3 (longest name = api)
    expect(out).toContain('○ api  ← db  (840ms)');
  });
});
