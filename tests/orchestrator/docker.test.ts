import { beforeEach, describe, expect, it, vi } from 'vitest';

const execaMock = vi.fn().mockResolvedValue({});
vi.mock('execa', () => ({ execa: (...args: unknown[]) => execaMock(...args) }));

import { processConfigSchema } from '../../src/config/schema.js';
import { removeDockerContainer } from '../../src/orchestrator/docker.js';

describe('removeDockerContainer', () => {
  beforeEach(() => execaMock.mockClear());

  it('force-removes the container for docker processes', async () => {
    const config = processConfigSchema.parse({
      type: 'docker',
      command: 'docker run --name pg postgres:16',
      container_name: 'pg',
    });
    await removeDockerContainer(config);
    expect(execaMock).toHaveBeenCalledTimes(1);
    const [bin, args] = execaMock.mock.calls[0] as [string, string[]];
    expect(bin).toBe('bash');
    expect(args).toEqual(['-c', 'docker rm -f pg >/dev/null 2>&1 || true']);
  });

  it('runs in the process cwd and env', async () => {
    const config = processConfigSchema.parse({
      type: 'docker',
      command: 'docker run --name api alpine',
      container_name: 'api',
      cwd: '/tmp/app',
      env: { FOO: 'bar' },
    });
    await removeDockerContainer(config);
    const [, , opts] = execaMock.mock.calls[0] as [
      string,
      string[],
      { cwd: string; env: Record<string, string> },
    ];
    expect(opts.cwd).toBe('/tmp/app');
    expect(opts.env.FOO).toBe('bar');
  });

  it('is a no-op for non-docker processes', async () => {
    const config = processConfigSchema.parse({ command: 'echo hi' });
    await removeDockerContainer(config);
    expect(execaMock).not.toHaveBeenCalled();
  });
});
