import { describe, expect, it } from 'vitest';
import {
  detectDockerRunName,
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
      hook_timeout_ms: 60_000,
    });
  });

  it('accepts a custom hook_timeout_ms for slow install hooks', () => {
    const parsed = processConfigSchema.parse({ command: 'echo hi', hook_timeout_ms: 600_000 });
    expect(parsed.hook_timeout_ms).toBe(600_000);
  });

  it('accepts manual_retry: true', () => {
    const parsed = processConfigSchema.parse({ command: 'echo hi', manual_retry: true });
    expect(parsed.manual_retry).toBe(true);
  });

  it('optional defaults to false', () => {
    expect(processConfigSchema.parse({ command: 'x' }).optional).toBe(false);
  });

  it('accepts optional: true', () => {
    expect(processConfigSchema.parse({ command: 'x', optional: true }).optional).toBe(true);
  });

  it('ports defaults to [] and kill_orphan_ports to false', () => {
    const parsed = processConfigSchema.parse({ command: 'x' });
    expect(parsed.ports).toEqual([]);
    expect(parsed.kill_orphan_ports).toBe(false);
  });

  it('accepts ports + kill_orphan_ports', () => {
    const parsed = processConfigSchema.parse({
      command: 'x',
      ports: [8080, 9099],
      kill_orphan_ports: true,
    });
    expect(parsed.ports).toEqual([8080, 9099]);
    expect(parsed.kill_orphan_ports).toBe(true);
  });

  it('rejects an out-of-range port', () => {
    expect(() => processConfigSchema.parse({ command: 'x', ports: [70_000] })).toThrow();
  });

  it('stop_command is optional and defaults to undefined', () => {
    const parsed = processConfigSchema.parse({ command: 'echo hi' });
    expect(parsed.stop_command).toBeUndefined();
  });

  it('accepts stop_command', () => {
    // NB: a `docker run --name ...` command would be rejected under type: bash
    // (see "named docker containers" below) — `docker compose` is the shape
    // stop_command actually exists for.
    const parsed = processConfigSchema.parse({
      command: 'docker compose up',
      stop_command: 'docker compose down',
    });
    expect(parsed.stop_command).toBe('docker compose down');
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
      // schema does NOT touch stop_command for docker — container teardown is
      // an orchestrator concern (removeDockerContainer). The schema only validates.
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

  describe('named docker containers under a non-docker type', () => {
    // A `docker run --name X` container is owned by the daemon, not by the CLI
    // client orckit signals — so under any type but `docker` it survives
    // shutdown with its ports bound. The schema rejects it rather than letting
    // the user discover the orphan later.
    it('rejects a bash process that runs a named container', () => {
      expect(() =>
        processConfigSchema.parse({
          command: 'docker run --rm --name foo -p 5432:5432 postgres:16',
        }),
      ).toThrow(/--name foo/);
    });

    it('names the container and the fix in the error message', () => {
      const result = processConfigSchema.safeParse({
        type: 'webpack',
        command: 'docker run --name mydb postgres:16',
      });
      expect(result.success).toBe(false);
      const message = result.error!.issues[0]!.message;
      expect(message).toMatch(/--name mydb/);
      expect(message).toMatch(/type: docker/);
      expect(message).toMatch(/container_name: mydb/);
      expect(result.error!.issues[0]!.path).toEqual(['type']);
    });

    it('accepts the same command with type: docker + container_name', () => {
      const parsed = processConfigSchema.parse({
        type: 'docker',
        command: 'docker run --rm --name foo -p 5432:5432 postgres:16',
        container_name: 'foo',
      });
      expect(parsed.type).toBe('docker');
      expect(parsed.container_name).toBe('foo');
    });

    it('does not flag docker exec, docker compose, or an unrelated --name', () => {
      expect(() =>
        processConfigSchema.parse({ command: 'docker exec --name foo api ls' }),
      ).not.toThrow();
      expect(() =>
        processConfigSchema.parse({ command: 'docker compose up --name foo' }),
      ).not.toThrow();
      expect(() =>
        processConfigSchema.parse({ command: './server --name worker --port 3000' }),
      ).not.toThrow();
      expect(() => processConfigSchema.parse({ command: 'docker run postgres:16' })).not.toThrow();
    });
  });
});

describe('detectDockerRunName', () => {
  it('finds a space-separated --name', () => {
    expect(detectDockerRunName('docker run --name foo postgres:16')).toBe('foo');
  });

  it('finds an =-separated --name', () => {
    expect(detectDockerRunName('docker run --name=foo postgres:16')).toBe('foo');
  });

  it('strips quotes around the name', () => {
    expect(detectDockerRunName('docker run --name "my-db" postgres:16')).toBe('my-db');
    expect(detectDockerRunName("docker run --name 'my_db.1' postgres:16")).toBe('my_db.1');
  });

  it('finds a docker run further down a pipeline', () => {
    expect(detectDockerRunName('echo starting && docker run --rm --name db postgres:16')).toBe(
      'db',
    );
    expect(detectDockerRunName('mkdir -p data; docker run --name db postgres:16')).toBe('db');
  });

  it('returns null for a docker run without --name', () => {
    expect(detectDockerRunName('docker run --rm -p 5432:5432 postgres:16')).toBeNull();
  });

  it('returns null for docker subcommands other than run', () => {
    expect(detectDockerRunName('docker exec --name foo api ls')).toBeNull();
    expect(detectDockerRunName('docker compose up -d')).toBeNull();
    expect(detectDockerRunName('docker compose run --name foo api')).toBeNull();
    expect(detectDockerRunName('docker build --name foo .')).toBeNull();
  });

  it('returns null when "docker run" is only part of a longer word', () => {
    expect(detectDockerRunName('mydocker run --name foo img')).toBeNull();
    expect(detectDockerRunName('docker-compose run --name foo api')).toBeNull();
    expect(detectDockerRunName('npm run docker --name foo')).toBeNull();
  });

  it('returns null for a command with no docker at all', () => {
    expect(detectDockerRunName('pnpm dev --name foo')).toBeNull();
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

  it('rejects required process depending on optional', () => {
    expect(() =>
      orckitConfigSchema.parse({
        processes: {
          tool: { command: 'echo tool', optional: true },
          required: { command: 'echo req', depends_on: ['tool'] },
        },
      }),
    ).toThrow(/cannot depend on optional/);
  });

  it('allows optional process depending on another optional', () => {
    const parsed = orckitConfigSchema.parse({
      processes: {
        toolA: { command: 'echo a', optional: true },
        toolB: { command: 'echo b', optional: true, depends_on: ['toolA'] },
      },
    });
    expect(parsed.processes.toolB?.depends_on).toEqual(['toolA']);
  });

  it('allows optional process depending on a required one', () => {
    const parsed = orckitConfigSchema.parse({
      processes: {
        core: { command: 'echo core' },
        admin: { command: 'echo admin', optional: true, depends_on: ['core'] },
      },
    });
    expect(parsed.processes.admin?.optional).toBe(true);
  });

  it('applies ide defaults when block is omitted', () => {
    const parsed = orckitConfigSchema.parse({ processes: { a: { command: 'echo' } } });
    expect(parsed.ide).toEqual({ enabled: true, command: 'webstorm' });
  });

  it('ide.command override keeps enabled default', () => {
    const parsed = orckitConfigSchema.parse({
      processes: { a: { command: 'echo' } },
      ide: { command: 'idea' },
    });
    expect(parsed.ide).toEqual({ enabled: true, command: 'idea' });
  });

  it('honors ide.enabled: false', () => {
    const parsed = orckitConfigSchema.parse({
      processes: { a: { command: 'echo' } },
      ide: { enabled: false },
    });
    expect(parsed.ide.enabled).toBe(false);
  });

  it('rejects an empty ide.command', () => {
    expect(() =>
      orckitConfigSchema.parse({
        processes: { a: { command: 'echo' } },
        ide: { command: '' },
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
