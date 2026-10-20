import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startOpenRelay, type OpenRelayHandle } from '../../src/sandbox/relay.js';

let relay: OpenRelayHandle | null = null;
let dir: string | null = null;
afterEach(async () => {
  await relay?.dispose();
  relay = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** The relay URL rewritten from host.docker.internal to the local listener. */
const local = (url: string) => url.replace('host.docker.internal', '127.0.0.1');

describe('startOpenRelay', () => {
  it('opens a file in the project with the IDE launcher', async () => {
    dir = mkdtempSync(join(tmpdir(), 'orckit-relay-'));
    const file = join(dir, 'a.ts');
    writeFileSync(file, '');
    // `true` stands in for the IDE launcher: spawns fine, does nothing.
    relay = await startOpenRelay({ command: 'true', root: dir });
    expect(relay.url).toMatch(/^http:\/\/host\.docker\.internal:\d+\/open\?token=[0-9a-f]{32}$/);
    const res = await fetch(`${local(relay.url)}&file=${encodeURIComponent(file)}&line=3`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, openedWith: 'true' });
  });

  it('never opens files outside the IDE project (sandboxed code could launch them)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'orckit-relay-'));
    relay = await startOpenRelay({ command: 'true', root: join(dir, 'project') });
    const outside = join(dir, 'evil.command');
    writeFileSync(outside, '');
    const res = await fetch(`${local(relay.url)}&file=${encodeURIComponent(outside)}`, {
      method: 'POST',
    });
    expect(res.status).toBe(403);
  });

  it('rejects a wrong token, relative paths and missing files', async () => {
    relay = await startOpenRelay({ command: 'true', root: '/' });
    const base = local(relay.url);
    const bad = base.replace(/token=\w+/, 'token=nope');
    expect((await fetch(`${bad}&file=/etc/hosts`, { method: 'POST' })).status).toBe(403);
    expect((await fetch(`${base}&file=rel.ts`, { method: 'POST' })).status).toBe(400);
    expect((await fetch(`${base}&file=/no/such/file`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${base}&file=/etc/hosts`)).status).toBe(404);
  });
});
