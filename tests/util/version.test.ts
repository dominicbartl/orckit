import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ORCKIT_VERSION } from '../../src/util/version.js';

describe('ORCKIT_VERSION', () => {
  it('is the version in package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(ORCKIT_VERSION).toBe(pkg.version);
  });
});
