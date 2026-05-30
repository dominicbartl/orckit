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

  it('streams stdout/stderr line-by-line to onLine when given', async () => {
    const lines: Array<[string, string]> = [];
    await runHook(
      'pre_stop',
      { pre_stop: 'echo one; echo two; echo err 1>&2' },
      { onLine: (text, stream) => lines.push([text, stream]) },
    );
    expect(lines).toContainEqual(['one', 'stdout']);
    expect(lines).toContainEqual(['two', 'stdout']);
    expect(lines).toContainEqual(['err', 'stderr']);
  });

  it('still captures stderr in the error while streaming', async () => {
    const lines: Array<[string, string]> = [];
    try {
      await runHook(
        'pre_stop',
        { pre_stop: 'echo boom 1>&2; exit 1' },
        { onLine: (text, stream) => lines.push([text, stream]) },
      );
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HookError);
      expect((err as HookError).stderr).toContain('boom');
      expect(lines).toContainEqual(['boom', 'stderr']);
    }
  });

  it('kills a hook that exceeds timeoutMs and reports a null exit code', async () => {
    try {
      await runHook('pre_start', { pre_start: 'sleep 5' }, { timeoutMs: 200 });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HookError);
      // A timed-out hook is killed by signal, so there's no exit code — this is
      // exactly the "(exit ?)" the user sees on a too-slow `pre_start` install.
      expect((err as HookError).exitCode).toBeNull();
      expect((err as HookError).message).toContain('exit ?');
    }
  });
});
