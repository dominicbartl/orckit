import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installedDnsPort,
  parseResolverPort,
  resolverConfig,
} from '../../src/sandbox/dns-resolver.js';

describe('resolver file', () => {
  it('round-trips the port through resolverConfig', () => {
    const config = resolverConfig(15353);
    expect(config).toContain('nameserver 127.0.0.1\nport 15353\n');
    expect(parseResolverPort(config)).toBe(15353);
  });

  it("is not ours without orckit's marker", () => {
    expect(parseResolverPort('nameserver 127.0.0.1\nport 15353\n')).toBeNull();
  });

  it('reads the installed port, null when the file is missing or foreign', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orckit-dns-'));
    try {
      const file = join(dir, 'test');
      expect(installedDnsPort(file)).toBeNull();
      writeFileSync(file, 'nameserver 10.0.0.1\n');
      expect(installedDnsPort(file)).toBeNull();
      writeFileSync(file, resolverConfig(5300));
      expect(installedDnsPort(file)).toBe(5300);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
