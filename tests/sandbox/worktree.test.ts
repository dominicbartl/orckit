import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  containerName,
  detectWorktree,
  dnsLabel,
  parseWorktree,
  sandboxDomain,
} from '../../src/sandbox/worktree.js';

describe('parseWorktree', () => {
  it('returns null for a main checkout (git dir is the common dir)', () => {
    expect(parseWorktree('/repo/.git', '/repo/.git', '/repo')).toBeNull();
  });

  it('names a linked worktree after its admin dir, not its branch or folder', () => {
    expect(parseWorktree('/repo/.git/worktrees/brave-a7', '/repo/.git', '/wt/feature')).toEqual({
      id: 'brave-a7',
      root: '/wt/feature',
      commonDir: '/repo/.git',
      mainRoot: '/repo',
    });
  });
});

describe('detectWorktree (real git)', () => {
  let dir: string;
  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'orckit-wt-')));
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: join(dir, 'main'), stdio: 'ignore' });
    mkdirSync(join(dir, 'main'));
    git('init', '-q');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
    git('worktree', 'add', '-q', '-b', 'feat/x', join(dir, 'Feature Tree'));
    mkdirSync(join(dir, 'Feature Tree', 'sub'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('is null in the main checkout and outside git', () => {
    expect(detectWorktree(join(dir, 'main'))).toBeNull();
    expect(detectWorktree(dir)).toBeNull();
  });

  it('detects the worktree from a subdirectory', () => {
    const wt = detectWorktree(join(dir, 'Feature Tree', 'sub'));
    expect(wt).toMatchObject({
      id: 'Feature-Tree',
      root: join(dir, 'Feature Tree'),
      commonDir: join(dir, 'main', '.git'),
      mainRoot: join(dir, 'main'),
    });
  });
});

describe('naming', () => {
  it('sanitizes to a DNS label', () => {
    expect(dnsLabel('Feature Tree/_x')).toBe('feature-tree-x');
    expect(dnsLabel('--a--')).toBe('a');
    expect(dnsLabel('___')).toBe('x');
    expect(dnsLabel('a'.repeat(80))).toHaveLength(63);
  });

  it('keeps long container names within the 63-char hostname/DNS limit, still unique', () => {
    const a = containerName(
      'molzait-backend-platform',
      'claude-brave-mcclintock-a7ae78-and-a-long-tail-a',
    );
    const b = containerName(
      'molzait-backend-platform',
      'claude-brave-mcclintock-a7ae78-and-a-long-tail-b',
    );
    expect(a.length).toBeLessThanOrEqual(63);
    expect(a).toMatch(/^orckit-molzait-backend-plat-claude-brave-.*-[0-9a-f]{6}$/);
    expect(a).not.toBe(b);
  });

  it('builds container names and domains', () => {
    expect(containerName('molzait', 'brave-mcclintock-a7ae78')).toBe(
      'orckit-molzait-brave-mcclintock-a7ae78',
    );
    expect(sandboxDomain('{name}.{project}.local', 'My App', 'wf_9fb2')).toBe(
      'wf-9fb2.my-app.local',
    );
  });
});
