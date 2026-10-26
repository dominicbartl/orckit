import { describe, it, expect } from 'vitest';
import {
  buildRunArgs,
  installedNodeModules,
  nodeModulesVolume,
  ORCKIT_NODE_MODULES,
  innerStartArgs,
  type SandboxRunSpec,
} from '../../src/sandbox/docker-args.js';

const spec = (over: Partial<SandboxRunSpec> = {}): SandboxRunSpec => ({
  name: 'orckit-app-wt1',
  domain: 'wt1.app.local',
  host: 'wt1.app.local',
  image: 'orckit-sandbox-app:abc',
  project: 'app',
  checkout: {
    id: 'wt1',
    root: '/repo/.claude/worktrees/wt1',
    commonDir: '/repo/.git',
    mainRoot: '/repo',
    linked: true,
  },
  packageRoot: '/opt/orckit',
  packageWritable: false,
  configPath: '/repo/.claude/worktrees/wt1/orckit.yaml',
  cwd: '/repo/.claude/worktrees/wt1',
  tty: true,
  homeSeeds: [{ source: '/Users/me/.config/stripe', rel: '.config/stripe' }],
  packageDirs: [],
  mounts: [],
  env: { FOO: 'bar' },
  clientPid: 4242,
  clientStart: 'Mon Oct 20 10:00:00 2026',
  reseed: false,
  startArgs: ['--config', '/repo/.claude/worktrees/wt1/orckit.yaml'],
  ...over,
});

/** The value following each occurrence of `flag`. */
const values = (args: string[], flag: string) =>
  args.flatMap((a, i) => (a === flag ? [args[i + 1]!] : []));

describe('buildRunArgs', () => {
  it('runs orc as the main process of a removable, privileged container', () => {
    const args = buildRunArgs(spec());
    expect(args.slice(0, 6)).toEqual(['run', '--rm', '-i', '-t', '--init', '--privileged']);
    expect(values(args, '--name')).toEqual(['orckit-app-wt1']);
    expect(args.slice(-6)).toEqual([
      'orckit-sandbox-app:abc',
      'node',
      '/opt/orckit/dist/cli.js',
      'start',
      '--config',
      '/repo/.claude/worktrees/wt1/orckit.yaml',
    ]);
    expect(values(args, '-w')).toEqual(['/repo/.claude/worktrees/wt1']);
  });

  it('caps memory and cpus only when configured', () => {
    const capped = buildRunArgs(spec({ memory: '8g', cpus: 4 }));
    expect(values(capped, '--memory')).toEqual(['8g']);
    expect(values(capped, '--cpus')).toEqual(['4']);
    expect(buildRunArgs(spec())).not.toContain('--memory');
    expect(buildRunArgs(spec())).not.toContain('--cpus');
  });

  it('omits -t without a terminal', () => {
    expect(buildRunArgs(spec({ tty: false }))).not.toContain('-t');
  });

  it('labels the container for OrbStack DNS and orckit bookkeeping', () => {
    expect(values(buildRunArgs(spec()), '--label')).toEqual([
      'dev.orbstack.domains=wt1.app.local',
      'orckit.sandbox=orckit-app-wt1',
      'orckit.project=app',
      'orckit.worktree=/repo/.claude/worktrees/wt1',
      'orckit.client-pid=4242',
      'orckit.client-start=Mon Oct 20 10:00:00 2026',
    ]);
  });

  it('mounts worktree, git dir and orckit at the same paths, plus state volumes and seeds', () => {
    expect(values(buildRunArgs(spec()), '-v')).toEqual([
      '/repo/.claude/worktrees/wt1:/repo/.claude/worktrees/wt1',
      '/repo/.git:/repo/.git',
      '/opt/orckit:/opt/orckit:ro',
      'orckit-app-wt1-docker:/var/lib/docker',
      'orckit-app-wt1-home:/root',
      '/Users/me/.config/stripe:/orckit-seed/.config/stripe:ro',
    ]);
  });

  it('mounts a main checkout once (its .git sits inside it)', () => {
    const main = {
      id: 'main',
      root: '/repo',
      commonDir: '/repo/.git',
      mainRoot: '/repo',
      linked: false,
    };
    const v = values(buildRunArgs(spec({ checkout: main, name: 'orckit-app-main' })), '-v');
    expect(v.slice(0, 2)).toEqual(['/repo:/repo', '/opt/orckit:/opt/orckit:ro']);
  });

  it('gives every package dir a private node_modules volume', () => {
    const v = values(buildRunArgs(spec({ packageDirs: ['', 'backend'] })), '-v');
    expect(v).toContain('orckit-app-wt1-nm-root:/repo/.claude/worktrees/wt1/node_modules');
    expect(v).toContain(
      `${nodeModulesVolume('orckit-app-wt1', 'backend')}:/repo/.claude/worktrees/wt1/backend/node_modules`,
    );
    expect(nodeModulesVolume('orckit-app-wt1', 'backend')).toMatch(
      /^orckit-app-wt1-nm-[0-9a-f]{10}$/,
    );
  });

  it('mounts orckit writable only when the project links to it', () => {
    expect(values(buildRunArgs(spec({ packageWritable: true })), '-v')).toContain(
      '/opt/orckit:/opt/orckit',
    );
  });

  it('mounts an installed orckit with its whole node_modules at a fixed path', () => {
    // pnpm, installed in the worktree itself: its Mac path is hidden by the
    // sandbox's node_modules volume, and `commander` sits outside the package dir.
    const pkg = '.pnpm/@orckit+cli@0.4.0/node_modules/@orckit/cli';
    const args = buildRunArgs(
      spec({
        packageRoot: `/repo/.claude/worktrees/wt1/node_modules/${pkg}`,
        packageWritable: true,
        packageDirs: [''],
      }),
    );
    const v = values(args, '-v');
    expect(v).toContain(`/repo/.claude/worktrees/wt1/node_modules:${ORCKIT_NODE_MODULES}:ro`);
    expect(v.filter((m) => m.includes('@orckit+cli'))).toEqual([]);
    expect(args).toContain(`${ORCKIT_NODE_MODULES}/${pkg}/dist/cli.js`);
  });

  it('splits an installed orckit at its outermost node_modules', () => {
    expect(installedNodeModules('/repo/node_modules/@orckit/cli')).toEqual({
      root: '/repo/node_modules',
      rel: '@orckit/cli',
    });
    expect(
      installedNodeModules('/repo/node_modules/.pnpm/@orckit+cli@0.4.0/node_modules/@orckit/cli'),
    ).toEqual({
      root: '/repo/node_modules',
      rel: '.pnpm/@orckit+cli@0.4.0/node_modules/@orckit/cli',
    });
    expect(installedNodeModules('/Users/me/orckit')).toBeNull();
  });

  it('skips mounts already covered by a parent mount', () => {
    const v = values(
      buildRunArgs(
        spec({
          packageRoot: '/repo/.claude/worktrees/wt1/tools/orckit',
          mounts: [
            {
              source: '/repo/.claude/worktrees/wt1/x',
              target: '/repo/.claude/worktrees/wt1/x',
              readonly: true,
            },
            { source: '/store', target: '/store', readonly: false },
          ],
        }),
      ),
      '-v',
    );
    expect(v.filter((m) => m.includes('tools/orckit'))).toEqual([]);
    expect(v.filter((m) => m.endsWith('wt1/x:ro'))).toEqual([]);
    expect(v).toContain('/store:/store');
  });

  it('passes sandbox identity, reseed and user env', () => {
    const e = values(buildRunArgs(spec({ reseed: true })), '-e');
    expect(e).toEqual(
      expect.arrayContaining([
        'ORCKIT_SANDBOX=orckit-app-wt1',
        'ORCKIT_SANDBOX_HOST=wt1.app.local',
        'ORCKIT_RESEED=1',
        'FOO=bar',
        'TERM',
      ]),
    );
    expect(values(buildRunArgs(spec()), '-e')).not.toContain('ORCKIT_RESEED=1');
  });

  it('keeps the OrbStack label on .local but prints the .test host', () => {
    const args = buildRunArgs(spec({ host: 'wt1.app.test' }));
    expect(values(args, '--label')).toContain('dev.orbstack.domains=wt1.app.local');
    expect(values(args, '-e')).toContain('ORCKIT_SANDBOX_HOST=wt1.app.test');
  });

  it('keys home seeding on the copy_home list, so additions re-seed', () => {
    const seeds = [
      { source: '/h/b', rel: 'b' },
      { source: '/h/a', rel: 'a' },
    ];
    expect(values(buildRunArgs(spec({ homeSeeds: seeds })), '-e')).toContain('ORCKIT_SEED_KEY=a,b');
  });
});

describe('innerStartArgs', () => {
  it('drops host-only flags and replaces the config path', () => {
    expect(
      innerStartArgs(
        [
          'api',
          '--sandbox',
          '-c',
          'x.yaml',
          '--with',
          'stripe',
          '--refresh-home',
          '--config=y',
          '-cz',
        ],
        '/abs/orckit.yaml',
      ),
    ).toEqual(['--config', '/abs/orckit.yaml', 'api', '--with', 'stripe']);
  });

  it('keeps everything else verbatim', () => {
    expect(innerStartArgs(['--no-live', '--show-output', '-w', 'a'], '/c.yaml')).toEqual([
      '--config',
      '/c.yaml',
      '--no-live',
      '--show-output',
      '-w',
      'a',
    ]);
  });
});
