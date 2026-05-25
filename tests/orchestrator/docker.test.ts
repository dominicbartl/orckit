import { describe, expect, it } from 'vitest';
import { processConfigSchema } from '../../src/config/schema.js';
import { applyDockerDefaults } from '../../src/orchestrator/docker.js';

describe('applyDockerDefaults', () => {
  it('fills in stop_command for docker processes', () => {
    const config = processConfigSchema.parse({
      type: 'docker',
      command: 'docker run --name pg postgres:16',
      container_name: 'pg',
    });
    const normalized = applyDockerDefaults(config);
    expect(normalized.stop_command).toBe('docker rm -f pg');
  });

  it('preserves an explicit stop_command', () => {
    const config = processConfigSchema.parse({
      type: 'docker',
      command: 'docker compose up',
      container_name: 'pg',
      stop_command: 'docker compose down',
    });
    const normalized = applyDockerDefaults(config);
    expect(normalized.stop_command).toBe('docker compose down');
  });

  it('returns the config unchanged for non-docker processes', () => {
    const config = processConfigSchema.parse({ command: 'echo hi' });
    expect(applyDockerDefaults(config)).toBe(config);
  });

  it('returns a new object only when defaults were applied', () => {
    const docker = processConfigSchema.parse({
      type: 'docker',
      command: 'docker run --name x alpine',
      container_name: 'x',
    });
    expect(applyDockerDefaults(docker)).not.toBe(docker);

    const already = processConfigSchema.parse({
      type: 'docker',
      command: 'docker run --name x alpine',
      container_name: 'x',
      stop_command: 'docker stop x',
    });
    expect(applyDockerDefaults(already)).toBe(already);
  });
});
