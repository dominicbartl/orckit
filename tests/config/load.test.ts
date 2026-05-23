import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseConfigText, validateConfig } from '../../src/config/load.js';

describe('parseConfigText', () => {
  it('parses minimal YAML', () => {
    const config = parseConfigText(`
project: demo
processes:
  hi:
    command: echo hello
`);
    expect(config.project).toBe('demo');
    expect(config.processes.hi?.command).toBe('echo hello');
  });

  it('rejects invalid YAML', () => {
    expect(() => parseConfigText('::not yaml::')).toThrow(ConfigError);
  });

  it('rejects schema-invalid YAML with field path', () => {
    try {
      parseConfigText(`
processes:
  bad:
    command: ''
`);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toContain('processes.bad.command');
    }
  });
});

describe('validateConfig', () => {
  it('round-trips a parsed config', () => {
    const result = validateConfig({ processes: { x: { command: 'echo' } } });
    expect(result.project).toBe('orckit');
    expect(result.processes.x?.type).toBe('bash');
  });
});

describe('loadConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orckit-load-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads a YAML file from disk', () => {
    const path = join(dir, 'orckit.yaml');
    writeFileSync(path, 'processes:\n  a:\n    command: ls\n');
    const config = loadConfig(path);
    expect(config.processes.a?.command).toBe('ls');
  });

  it('reports missing files with the path', () => {
    expect(() => loadConfig(join(dir, 'missing.yaml'))).toThrow(/missing.yaml/);
  });
});
