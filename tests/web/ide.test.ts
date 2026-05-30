import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { detectIde } from '../../src/web/ide.js';

describe('detectIde', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orckit-ide-'));
  });

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it('returns null when there is no .idea folder', () => {
    expect(detectIde(root)).toBeNull();
  });

  it('detects a JetBrains project from .idea and defaults to WebStorm', () => {
    mkdirSync(join(root, '.idea'));
    const link = detectIde(root);
    expect(link).toEqual({
      toolTag: 'web-storm',
      project: basename(root),
      root,
    });
  });

  it('maps the configured tool to its Toolbox toolTag', () => {
    mkdirSync(join(root, '.idea'));
    expect(detectIde(root, { tool: 'intellij' })?.toolTag).toBe('idea');
    expect(detectIde(root, { tool: 'phpstorm' })?.toolTag).toBe('php-storm');
    expect(detectIde(root, { tool: 'rider' })?.toolTag).toBe('rd');
  });

  it('prefers .idea/.name over the folder basename', () => {
    mkdirSync(join(root, '.idea'));
    writeFileSync(join(root, '.idea', '.name'), 'Custom Project\n');
    expect(detectIde(root)?.project).toBe('Custom Project');
  });

  it('honors an explicit project override', () => {
    mkdirSync(join(root, '.idea'));
    writeFileSync(join(root, '.idea', '.name'), 'FromFile');
    expect(detectIde(root, { project: 'override' })?.project).toBe('override');
  });

  it('walks up from a nested directory to find .idea', () => {
    mkdirSync(join(root, '.idea'));
    const nested = join(root, 'packages', 'web');
    mkdirSync(nested, { recursive: true });
    const link = detectIde(nested);
    expect(link?.root).toBe(root);
    expect(link?.project).toBe(basename(root));
  });
});
