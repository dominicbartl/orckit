import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findPackageDirs } from '../../src/sandbox/packages.js';

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

const pkg = (rel: string) => {
  mkdirSync(join(dir!, rel), { recursive: true });
  writeFileSync(join(dir!, rel, 'package.json'), '{}');
};

describe('findPackageDirs', () => {
  it('finds every package.json dir, never-installed ones included', () => {
    dir = mkdtempSync(join(tmpdir(), 'orckit-pkgs-'));
    pkg('');
    pkg('backend');
    pkg('frontend/apps/events/ssr-function');
    mkdirSync(join(dir, 'docs'));
    expect(findPackageDirs(dir)).toEqual(['', 'backend', 'frontend/apps/events/ssr-function']);
  });

  it('skips node_modules and dot-directories (e.g. other worktrees)', () => {
    dir = mkdtempSync(join(tmpdir(), 'orckit-pkgs-'));
    pkg('');
    pkg('node_modules/left-pad');
    pkg('.claude/worktrees/other');
    expect(findPackageDirs(dir)).toEqual(['']);
  });

  it('stops at maxDepth', () => {
    dir = mkdtempSync(join(tmpdir(), 'orckit-pkgs-'));
    pkg('a/b/c');
    expect(findPackageDirs(dir, 2)).toEqual([]);
    expect(findPackageDirs(dir, 3)).toEqual(['a/b/c']);
  });
});
