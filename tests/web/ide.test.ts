import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('detects a JetBrains project from .idea with the default launcher + root', () => {
    mkdirSync(join(root, '.idea'));
    expect(detectIde(root)).toEqual({ command: 'webstorm', root });
  });

  it('honors a custom launcher command', () => {
    mkdirSync(join(root, '.idea'));
    expect(detectIde(root, { command: 'idea' })).toEqual({ command: 'idea', root });
  });

  it('walks up from a nested directory to find .idea and reports the .idea parent as root', () => {
    mkdirSync(join(root, '.idea'));
    const nested = join(root, 'packages', 'web');
    mkdirSync(nested, { recursive: true });
    expect(detectIde(nested)).toEqual({ command: 'webstorm', root });
  });
});
