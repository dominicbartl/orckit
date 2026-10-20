import { describe, it, expect } from 'vitest';
import { validateConfig } from '../../src/config/load.js';
import { expandPath, shouldSandbox } from '../../src/sandbox/run.js';

const wt = { id: 'wt1', root: '/r/wt1', commonDir: '/r/.git', mainRoot: '/r', linked: true };
const main = { id: 'main', root: '/r', commonDir: '/r/.git', mainRoot: '/r', linked: false };
const base = { processes: { a: { command: 'true' } } };
const withBlock = validateConfig({ ...base, sandbox: {} });
const disabled = validateConfig({ ...base, sandbox: { enabled: false } });
const without = validateConfig(base);

describe('shouldSandbox', () => {
  it('auto: needs an enabled sandbox block AND a worktree', () => {
    expect(
      shouldSandbox({ flag: undefined, config: withBlock, checkout: wt, insideSandbox: false }),
    ).toBe(true);
    expect(
      shouldSandbox({ flag: undefined, config: withBlock, checkout: null, insideSandbox: false }),
    ).toBe(false);
    expect(
      shouldSandbox({ flag: undefined, config: without, checkout: wt, insideSandbox: false }),
    ).toBe(false);
    expect(
      shouldSandbox({ flag: undefined, config: disabled, checkout: wt, insideSandbox: false }),
    ).toBe(false);
  });

  it('--no-sandbox always wins; never recurses from inside a sandbox', () => {
    expect(
      shouldSandbox({ flag: false, config: withBlock, checkout: wt, insideSandbox: false }),
    ).toBe(false);
    expect(
      shouldSandbox({ flag: true, config: withBlock, checkout: wt, insideSandbox: true }),
    ).toBe(false);
  });

  it('--sandbox forces it, but only in a git checkout', () => {
    expect(shouldSandbox({ flag: true, config: without, checkout: wt, insideSandbox: false })).toBe(
      true,
    );
    expect(() =>
      shouldSandbox({ flag: true, config: without, checkout: null, insideSandbox: false }),
    ).toThrow(/needs a git checkout/);
  });
});

describe('shouldSandbox in the main checkout', () => {
  const always = validateConfig({ ...base, sandbox: { main_checkout: true } });
  it('runs natively by default, sandboxed with main_checkout: true', () => {
    expect(
      shouldSandbox({ flag: undefined, config: withBlock, checkout: main, insideSandbox: false }),
    ).toBe(false);
    expect(
      shouldSandbox({ flag: undefined, config: always, checkout: main, insideSandbox: false }),
    ).toBe(true);
  });

  it('--sandbox / --no-sandbox override it either way', () => {
    expect(
      shouldSandbox({ flag: true, config: without, checkout: main, insideSandbox: false }),
    ).toBe(true);
    expect(
      shouldSandbox({ flag: false, config: always, checkout: main, insideSandbox: false }),
    ).toBe(false);
  });
});

describe('sandbox schema defaults', () => {
  it('fills defaults for an empty block', () => {
    expect(withBlock.sandbox).toEqual({
      enabled: true,
      main_checkout: false,
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
