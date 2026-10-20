import { describe, it, expect } from 'vitest';
import { validateConfig } from '../../src/config/load.js';
import { expandPath, shouldSandbox } from '../../src/sandbox/run.js';

const wt = { id: 'wt1', root: '/r/wt1', commonDir: '/r/.git', mainRoot: '/r' };
const base = { processes: { a: { command: 'true' } } };
const withBlock = validateConfig({ ...base, sandbox: {} });
const disabled = validateConfig({ ...base, sandbox: { enabled: false } });
const without = validateConfig(base);

describe('shouldSandbox', () => {
  it('auto: needs an enabled sandbox block AND a worktree', () => {
    expect(
      shouldSandbox({ flag: undefined, config: withBlock, worktree: wt, insideSandbox: false }),
    ).toBe(true);
    expect(
      shouldSandbox({ flag: undefined, config: withBlock, worktree: null, insideSandbox: false }),
    ).toBe(false);
    expect(
      shouldSandbox({ flag: undefined, config: without, worktree: wt, insideSandbox: false }),
    ).toBe(false);
    expect(
      shouldSandbox({ flag: undefined, config: disabled, worktree: wt, insideSandbox: false }),
    ).toBe(false);
  });

  it('--no-sandbox always wins; never recurses from inside a sandbox', () => {
    expect(
      shouldSandbox({ flag: false, config: withBlock, worktree: wt, insideSandbox: false }),
    ).toBe(false);
    expect(
      shouldSandbox({ flag: true, config: withBlock, worktree: wt, insideSandbox: true }),
    ).toBe(false);
  });

  it('--sandbox forces it, but only in a worktree', () => {
    expect(shouldSandbox({ flag: true, config: without, worktree: wt, insideSandbox: false })).toBe(
      true,
    );
    expect(() =>
      shouldSandbox({ flag: true, config: without, worktree: null, insideSandbox: false }),
    ).toThrow(/needs a linked git worktree/);
  });
});

describe('sandbox schema defaults', () => {
  it('fills defaults for an empty block', () => {
    expect(withBlock.sandbox).toEqual({
      enabled: true,
      domain: '{name}.{project}.local',
      copy_home: [],
      copy_files: [],
      mounts: [],
      env: {},
    });
  });
});

describe('sandbox schema validation', () => {
  it('accepts Docker memory notation and rejects anything else', () => {
    expect(validateConfig({ ...base, sandbox: { memory: '8g', cpus: 2.5 } }).sandbox).toMatchObject(
      {
        memory: '8g',
        cpus: 2.5,
      },
    );
    expect(() => validateConfig({ ...base, sandbox: { memory: '8 GB' } })).toThrow(/memory/);
  });
});

describe('expandPath', () => {
  it('expands ~ and resolves relative paths against the base', () => {
    expect(expandPath('~', '/b', '/h')).toBe('/h');
    expect(expandPath('~/x/y', '/b', '/h')).toBe('/h/x/y');
    expect(expandPath('rel/z', '/b', '/h')).toBe('/b/rel/z');
    expect(expandPath('/abs', '/b', '/h')).toBe('/abs');
  });
});
