import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * debug.ts reads env at import time, so each scenario re-imports the module
 * with a patched process.env via vi.resetModules + vi.stubEnv.
 */
async function loadDebug(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, '');
    else vi.stubEnv(k, v);
  }
  // Clear the two vars we care about when not provided so a leaked outer env
  // doesn't bleed into the assertion.
  if (!('ORCKIT_LOG_LEVEL' in env)) vi.stubEnv('ORCKIT_LOG_LEVEL', '');
  if (!('ORCKIT_DEBUG' in env)) vi.stubEnv('ORCKIT_DEBUG', '');
  return import('../../src/reporter/debug.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('createDebug', () => {
  it('emits info/warn/error at the default level but suppresses debug', async () => {
    const { createDebug } = await loadDebug({});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const d = createDebug('Test');
    d.debug('hidden');
    d.info('hello');
    d.warn('careful');
    d.error('broken');

    // debug is gated off (namespace not enabled), info/warn/error pass through.
    expect(log).toHaveBeenCalledWith('[info] Test:', 'hello');
    expect(warn).toHaveBeenCalledWith('[warn] Test:', 'careful');
    expect(error).toHaveBeenCalledWith('[error] Test:', 'broken');
    expect(log).not.toHaveBeenCalledWith('[debug] Test:', 'hidden');
  });

  it('passes through structured data when provided', async () => {
    const { createDebug } = await loadDebug({});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDebug('Ns').info('with data', { a: 1 });
    expect(log).toHaveBeenCalledWith('[info] Ns:', 'with data', { a: 1 });
  });

  it('honors ORCKIT_LOG_LEVEL=warn by dropping info', async () => {
    const { createDebug } = await loadDebug({ ORCKIT_LOG_LEVEL: 'warn' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const d = createDebug('Test');
    d.info('quiet');
    d.warn('loud');

    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[warn] Test:', 'loud');
  });

  it('emits debug output when its namespace is enabled via ORCKIT_DEBUG', async () => {
    const { createDebug } = await loadDebug({
      ORCKIT_LOG_LEVEL: 'debug',
      ORCKIT_DEBUG: 'Enabled',
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    createDebug('Enabled').debug('on');
    createDebug('Disabled').debug('off');

    expect(log).toHaveBeenCalledWith('[debug] Enabled:', 'on');
    expect(log).not.toHaveBeenCalledWith('[debug] Disabled:', 'off');
  });

  it('ORCKIT_DEBUG=* enables debug for every namespace', async () => {
    const { createDebug } = await loadDebug({
      ORCKIT_LOG_LEVEL: 'debug',
      ORCKIT_DEBUG: '*',
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    createDebug('Anything').debug('shown');
    expect(log).toHaveBeenCalledWith('[debug] Anything:', 'shown');
  });
});
