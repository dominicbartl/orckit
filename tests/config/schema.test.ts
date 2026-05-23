import { describe, expect, it } from 'vitest';
import {
  orckitConfigSchema,
  processConfigSchema,
  readyCheckSchema,
} from '../../src/config/schema.js';

describe('processConfigSchema', () => {
  it('applies sensible defaults', () => {
    const parsed = processConfigSchema.parse({ command: 'echo hi' });
    expect(parsed).toMatchObject({
      type: 'bash',
      category: 'default',
      restart: 'on-failure',
      restart_delay_ms: 2000,
      max_retries: 3,
      env: {},
      depends_on: [],
      buffer_size: 1000,
      manual_retry: false,
    });
  });

  it('accepts manual_retry: true', () => {
    const parsed = processConfigSchema.parse({ command: 'echo hi', manual_retry: true });
    expect(parsed.manual_retry).toBe(true);
  });

  it('requires a command', () => {
    expect(() => processConfigSchema.parse({})).toThrow();
  });

  it('rejects unknown process types', () => {
    expect(() => processConfigSchema.parse({ command: 'x', type: 'nope' })).toThrow();
  });

  it('accepts known types', () => {
    expect(processConfigSchema.parse({ command: 'x', type: 'webpack' }).type).toBe('webpack');
    expect(processConfigSchema.parse({ command: 'x', type: 'angular' }).type).toBe('angular');
  });
});

describe('readyCheckSchema', () => {
  it('parses http check with defaults', () => {
    const parsed = readyCheckSchema.parse({ type: 'http', url: 'http://localhost:3000' });
    expect(parsed).toMatchObject({
      type: 'http',
      expected_status: 200,
      interval_ms: 1000,
      timeout_ms: 60_000,
    });
  });

  it('parses tcp check with port range validation', () => {
    expect(() => readyCheckSchema.parse({ type: 'tcp', port: 0 })).toThrow();
    expect(() => readyCheckSchema.parse({ type: 'tcp', port: 70_000 })).toThrow();
    expect(readyCheckSchema.parse({ type: 'tcp', port: 5432 }).port).toBe(5432);
  });

  it('rejects unknown check type', () => {
    expect(() => readyCheckSchema.parse({ type: 'nope' })).toThrow();
  });

  it('requires non-empty pattern for log-pattern', () => {
    expect(() => readyCheckSchema.parse({ type: 'log-pattern', pattern: '' })).toThrow();
  });
});

describe('orckitConfigSchema', () => {
  it('requires at least one process', () => {
    expect(() => orckitConfigSchema.parse({ processes: {} })).toThrow();
  });

  it('applies project default', () => {
    const parsed = orckitConfigSchema.parse({ processes: { a: { command: 'echo' } } });
    expect(parsed.project).toBe('orckit');
    expect(parsed.preflight).toEqual([]);
  });

  it('accepts a complete configuration', () => {
    const parsed = orckitConfigSchema.parse({
      project: 'demo',
      processes: {
        db: { command: 'postgres', type: 'bash', category: 'infra' },
        api: {
          command: 'npm start',
          depends_on: ['db'],
          ready: { type: 'http', url: 'http://localhost:3000' },
          hooks: { pre_start: 'npm install' },
        },
      },
      preflight: [{ name: 'node', command: 'node --version' }],
    });
    expect(parsed.processes.api?.depends_on).toEqual(['db']);
    expect(parsed.preflight).toHaveLength(1);
  });
});
