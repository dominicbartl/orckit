import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  containerName,
  detectCheckout,
  dnsLabel,
  parseCheckout,
  sandboxDomain,
} from '../../src/sandbox/worktree.js';

describe('parseCheckout', () => {
  it('names the main checkout `main` (its git dir is the common dir)', () => {
    expect(parseCheckout('/repo/.git', '/repo/.git', '/repo')).toEqual({
      id: 'main',
      root: '/repo',
      commonDir: '/repo/.git',
      mainRoot: '/repo',
      linked: false,
    });
  });

  it('names a linked worktree after its admin dir, not its branch or folder', () => {
    expect(parseCheckout('/repo/.git/worktrees/brave-a7', '/repo/.git', '/wt/feature')).toEqual({
      id: 'brave-a7',
      root: '/wt/feature',
      commonDir: '/repo/.git',
      mainRoot: '/repo',
      linked: true,
    });
  });
});

describe('detectCheckout (real git)', () => {
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

  it('detects the main checkout, and nothing outside git', () => {
    expect(detectCheckout(join(dir, 'main'))).toMatchObject({ id: 'main', linked: false });
    expect(detectCheckout(dir)).toBeNull();
  });

  it('detects the worktree from a subdirectory', () => {
    const wt = detectCheckout(join(dir, 'Feature Tree', 'sub'));
    expect(wt).toMatchObject({
      id: 'Feature-Tree',
      root: join(dir, 'Feature Tree'),
      commonDir: join(dir, 'main', '.git'),
      mainRoot: join(dir, 'main'),
      linked: true,
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
