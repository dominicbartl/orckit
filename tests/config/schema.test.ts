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
      restart: 'never',
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

  it('stop_command is optional and defaults to undefined', () => {
    const parsed = processConfigSchema.parse({ command: 'echo hi' });
    expect(parsed.stop_command).toBeUndefined();
  });

  it('accepts stop_command', () => {
    const parsed = processConfigSchema.parse({
      command: 'docker run --name foo postgres:15',
      stop_command: 'docker stop foo',
    });
    expect(parsed.stop_command).toBe('docker stop foo');
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

  describe('type: docker', () => {
    it('requires container_name', () => {
      expect(() =>
        processConfigSchema.parse({
          type: 'docker',
          command: 'docker run --name foo postgres:16',
        }),
      ).toThrow(/container_name is required/);
    });

    it('accepts a valid docker process', () => {
      const parsed = processConfigSchema.parse({
        type: 'docker',
        command: 'docker run --name foo postgres:16',
        container_name: 'foo',
      });
      expect(parsed.type).toBe('docker');
      expect(parsed.container_name).toBe('foo');
      // schema does NOT auto-fill stop_command — that's an orchestrator
      // concern (applyDockerDefaults). The schema only validates.
      expect(parsed.stop_command).toBeUndefined();
    });

    it('rejects container_name on non-docker types', () => {
      expect(() =>
        processConfigSchema.parse({
          type: 'bash',
          command: 'echo hi',
          container_name: 'foo',
        }),
      ).toThrow(/container_name only applies to type: docker/);
    });

    it('rejects malformed container names', () => {
      expect(() =>
        processConfigSchema.parse({
          type: 'docker',
          command: 'x',
          container_name: 'foo;rm -rf /',
        }),
      ).toThrow(/invalid Docker container name/);
      expect(() =>
        processConfigSchema.parse({
          type: 'docker',
          command: 'x',
          container_name: '-leading-dash',
        }),
      ).toThrow(/invalid Docker container name/);
    });

    it('allows the user to override stop_command', () => {
      const parsed = processConfigSchema.parse({
        type: 'docker',
        command: 'docker run --name foo postgres:16',
        container_name: 'foo',
        stop_command: 'docker compose down',
      });
      expect(parsed.stop_command).toBe('docker compose down');
    });
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

  it('applies logs defaults', () => {
    const parsed = orckitConfigSchema.parse({ processes: { a: { command: 'echo' } } });
    expect(parsed.logs).toEqual({ enabled: false, dir: '.orckit/logs' });
  });

  it('accepts a custom logs block', () => {
    const parsed = orckitConfigSchema.parse({
      processes: { a: { command: 'echo' } },
      logs: { enabled: true, dir: '/var/log/orckit' },
    });
    expect(parsed.logs).toEqual({ enabled: true, dir: '/var/log/orckit' });
  });

  it('logs.enabled partial override keeps default dir', () => {
    const parsed = orckitConfigSchema.parse({
      processes: { a: { command: 'echo' } },
      logs: { enabled: true },
    });
    expect(parsed.logs).toEqual({ enabled: true, dir: '.orckit/logs' });
  });

  it('applies mcp defaults when block is omitted', () => {
    const parsed = orckitConfigSchema.parse({ processes: { a: { command: 'echo' } } });
    expect(parsed.mcp).toEqual({ enabled: true, port: 7676, host: '127.0.0.1' });
  });

  it('applies mcp defaults when block is empty', () => {
    const parsed = orckitConfigSchema.parse({
      processes: { a: { command: 'echo' } },
      mcp: {},
    });
    expect(parsed.mcp).toEqual({ enabled: true, port: 7676, host: '127.0.0.1' });
  });

  it('mcp.port partial override keeps other defaults', () => {
    const parsed = orckitConfigSchema.parse({
      processes: { a: { command: 'echo' } },
      mcp: { port: 7700 },
    });
    expect(parsed.mcp).toEqual({ enabled: true, port: 7700, host: '127.0.0.1' });
  });

  it('mcp.enabled: false is honored', () => {
    const parsed = orckitConfigSchema.parse({
      processes: { a: { command: 'echo' } },
      mcp: { enabled: false },
    });
    expect(parsed.mcp.enabled).toBe(false);
  });

  it('rejects mcp.port out of range', () => {
    expect(() =>
      orckitConfigSchema.parse({
        processes: { a: { command: 'echo' } },
        mcp: { port: 0 },
      }),
    ).toThrow();
    expect(() =>
      orckitConfigSchema.parse({
        processes: { a: { command: 'echo' } },
        mcp: { port: 70_000 },
      }),
    ).toThrow();
  });

  it('rejects non-integer mcp.port', () => {
    expect(() =>
      orckitConfigSchema.parse({
        processes: { a: { command: 'echo' } },
        mcp: { port: 7676.5 },
      }),
    ).toThrow();
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
