/**
 * Optional process integration tests.
 *
 *  - `orc start` (no targets) skips optional processes
 *  - `orc start <opt>` (explicit) starts the optional + its deps
 *  - `orc start --with <opt>` (additive) adds the optional to the default set
 *  - `orckit.startTargets(['opt'])` (runtime) starts it after initial boot,
 *    pulls in deps, leaves siblings alone, and DOESN'T emit boot:complete
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Orckit } from '../../src/orchestrator/orchestrator.js';
import { validateConfig } from '../../src/config/load.js';

function config() {
  return validateConfig({
    project: 't',
    processes: {
      core: { command: 'sleep 5', ready: { type: 'log-pattern', pattern: '.', timeout_ms: 100 } },
      // We won't actually wait on `core` to print anything — just skip the
      // health check by giving a tiny window; the test below uses exit-code
      // ready instead.
    },
  });
}

describe('Optional processes', () => {
  let orckit: Orckit | null = null;

  afterEach(async () => {
    if (orckit) {
      await orckit.dispose();
      orckit = null;
    }
  });

  it('start() with no targets skips optional processes', async () => {
    orckit = new Orckit(
      validateConfig({
        project: 't',
        processes: {
          core: { command: 'echo core', ready: { type: 'exit-code' } },
          tool: { command: 'echo tool', ready: { type: 'exit-code' }, optional: true },
        },
      }),
    );
    const summary = await orckit.start();
    expect(summary.ready).toEqual(['core']);
    expect(orckit.state('core')).toBe('finished');
    expect(orckit.state('tool')).toBe('pending');
  });

  it('explicit `start([name])` boots an optional + its deps', async () => {
    orckit = new Orckit(
      validateConfig({
        project: 't',
        processes: {
          core: { command: 'echo core', ready: { type: 'exit-code' } },
          tool: {
            command: 'echo tool',
            ready: { type: 'exit-code' },
            optional: true,
            depends_on: ['core'],
          },
        },
      }),
    );
    await orckit.start(['tool']);
    expect(orckit.state('core')).toBe('finished');
    expect(orckit.state('tool')).toBe('finished');
  });

  it('startTargets() at runtime starts the optional + deps, no boot event', async () => {
    orckit = new Orckit(
      validateConfig({
        project: 't',
        processes: {
          core: { command: 'echo core', ready: { type: 'exit-code' } },
          tool: {
            command: 'echo tool',
            ready: { type: 'exit-code' },
            optional: true,
            depends_on: ['core'],
          },
          other: {
            command: 'echo other',
            ready: { type: 'exit-code' },
            optional: true,
          },
        },
      }),
    );

    // Initial boot: only core, both optionals stay pending.
    await orckit.start();
    expect(orckit.state('core')).toBe('finished');
    expect(orckit.state('tool')).toBe('pending');
    expect(orckit.state('other')).toBe('pending');

    // Runtime add: starting `tool` should leave `other` alone.
    let bootCompleteCount = 0;
    orckit.on('boot:complete', () => bootCompleteCount++);

    await orckit.startTargets(['tool']);
    expect(orckit.state('tool')).toBe('finished');
    expect(orckit.state('other')).toBe('pending'); // untouched
    expect(bootCompleteCount).toBe(0); // no boot event for runtime adds
  });

  it('startTargets() skips already-running shared dependencies', async () => {
    orckit = new Orckit(
      validateConfig({
        project: 't',
        processes: {
          shared: {
            command: 'echo shared; sleep 30',
            ready: { type: 'log-pattern', pattern: 'shared', timeout_ms: 2000 },
          },
          tool: {
            command: 'echo tool',
            ready: { type: 'exit-code' },
            optional: true,
            depends_on: ['shared'],
          },
        },
      }),
    );

    await orckit.start();
    const sharedPidBefore = orckit.inspect('shared').pid;
    expect(sharedPidBefore).not.toBeNull();

    await orckit.startTargets(['tool']);
    // shared shouldn't have been re-spawned — same PID
    expect(orckit.inspect('shared').pid).toBe(sharedPidBefore);
    expect(orckit.state('tool')).toBe('finished');
  });

  it('startTargets() rejects unknown names', async () => {
    orckit = new Orckit(
      validateConfig({
        project: 't',
        processes: {
          core: { command: 'echo core', ready: { type: 'exit-code' } },
        },
      }),
    );
    await orckit.start();
    await expect(orckit.startTargets(['ghost'])).rejects.toThrow();
  });
});

// dummy to avoid unused-var on the helper above if the test ever evolves
void config;
