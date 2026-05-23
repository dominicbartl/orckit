import { describe, expect, it } from 'vitest';
import { HookError, runHook } from '../../src/orchestrator/hooks.js';

describe('runHook', () => {
  it('is a no-op when the hook is missing', async () => {
    await expect(runHook('pre_start', undefined)).resolves.toBeUndefined();
    await expect(runHook('pre_start', { post_start: 'echo x' })).resolves.toBeUndefined();
  });

  it('runs a successful hook command', async () => {
    await expect(runHook('pre_start', { pre_start: 'true' })).resolves.toBeUndefined();
  });

  it('throws HookError on non-zero exit', async () => {
    await expect(runHook('pre_start', { pre_start: 'exit 7' })).rejects.toBeInstanceOf(HookError);
  });

  it('captures stderr in the error', async () => {
    try {
      await runHook('pre_start', { pre_start: 'echo boom 1>&2 && exit 1' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HookError);
      expect((err as HookError).stderr).toContain('boom');
      expect((err as HookError).exitCode).toBe(1);
    }
  });

  it('passes env vars through', async () => {
    await runHook('pre_start', { pre_start: '[ "$MY_VAR" = "yes" ]' }, { env: { MY_VAR: 'yes' } });
  });
});
