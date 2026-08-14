/**
 * Process-tree regressions.
 *
 * These spawn REAL detached bash trees, because the bug this module exists for
 * is not expressible against a stub: a wrapper script that runs `set -m` (bash
 * monitor mode) puts each of its jobs in its OWN process group, so signalling
 * the root's group — the old teardown — left those grandchildren running with
 * the port still bound. The fixture below reproduces exactly that shape:
 *
 *   bash (root, detached → own group)
 *     └── bash -c 'set -m; sleep & sleep'   (same group as root)
 *           ├── sleep   (its own group — escaped)
 *           └── sleep   (its own group — escaped)
 *
 * Every pid spawned here is recorded and force-killed in afterEach, including
 * the escaped groups; nothing this file did not spawn is ever signalled.
 */

import { execa } from 'execa';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectProcessTree,
  collectProcessTreeSync,
  detailedTreeFrom,
  mergeTrees,
  signalTree,
  snapshotAll,
  survivors,
  treeFrom,
  type ProcessTree,
  type PsRow,
} from '../../src/util/process-tree.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Everything this file spawned, torn down in afterEach even when a test fails. */
const spawnedRoots: number[] = [];
const spawnedTrees: ProcessTree[] = [];

/** Best-effort SIGKILL of a recorded tree — cleanup must never throw. */
function forceKill(tree: ProcessTree): void {
  for (const pgid of tree.pgids) {
    if (pgid <= 1) continue;
    try {
      process.kill(-pgid, 'SIGKILL');
    } catch {
      /* group already gone */
    }
  }
  for (const pid of tree.pids) {
    if (pid <= 1 || pid === process.pid) continue;
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already exited */
    }
  }
}

afterEach(() => {
  for (const tree of spawnedTrees.splice(0)) forceKill(tree);
  for (const pid of spawnedRoots.splice(0)) forceKill({ pids: [pid], pgids: [pid] });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** This test runner's own process group, read the way the module reads `ps`. */
function ownPgid(): number {
  const out = execFileSync('ps', ['-p', String(process.pid), '-o', 'pgid='], {
    encoding: 'utf-8',
  });
  return Number(out.trim());
}

interface Fixture {
  root: number;
  /** The intermediate bash, in the root's group. */
  child: number;
  /** The `set -m` jobs, each leading its own group. */
  grandchildren: number[];
  rows: PsRow[];
}

/**
 * A detached three-level tree whose leaves escaped into their own groups. The
 * trailing `sleep` in the outer shell is load-bearing: without a command after
 * it, bash `exec`s the inner shell and the middle layer disappears.
 */
async function escapedTree(): Promise<Fixture> {
  const sub = execa('bash', ['-c', `bash -c 'set -m; sleep 30 & sleep 30'; sleep 30`], {
    detached: true,
    reject: false,
    stdin: 'ignore',
  });
  const root = sub.pid!;
  spawnedRoots.push(root);
  // Let the shells fork far enough to be visible to `ps`.
  await sleep(250);

  const rows = await snapshotAll();
  const child = rows.find((r) => r.ppid === root)?.pid;
  expect(child, 'inner shell never appeared').toBeDefined();
  const grandchildren = rows.filter((r) => r.ppid === child).map((r) => r.pid);
  expect(grandchildren.length, 'set -m jobs never appeared').toBeGreaterThanOrEqual(2);

  const fixture = { root, child: child!, grandchildren, rows };
  spawnedTrees.push(treeFrom(rows, root));
  return fixture;
}

/** A pid that is guaranteed gone: spawned by us, killed, and reaped. */
async function deadPid(): Promise<number> {
  const sub = execa('bash', ['-c', 'sleep 30'], {
    detached: true,
    reject: false,
    stdin: 'ignore',
  });
  const pid = sub.pid!;
  spawnedRoots.push(pid);
  await sleep(200);
  process.kill(-pid, 'SIGKILL');
  await sub.catch(() => {});
  for (let i = 0; i < 50 && alive(pid); i++) await sleep(20);
  expect(alive(pid)).toBe(false);
  return pid;
}

describe('collectProcessTree', () => {
  it('finds descendants that escaped into their own process group', async () => {
    // THE regression: `set -m` grandchildren are unreachable from the root's
    // group, so both the pid walk and the group set have to carry them.
    const { root, child, grandchildren, rows } = await escapedTree();
    const tree = await collectProcessTree(root);

    expect(tree.pids).toContain(root);
    expect(tree.pids).toContain(child);
    for (const gc of grandchildren) expect(tree.pids).toContain(gc);

    const rootPgid = rows.find((r) => r.pid === root)!.pgid;
    expect(tree.pgids).toContain(rootPgid);
    for (const gc of grandchildren) {
      const pgid = rows.find((r) => r.pid === gc)!.pgid;
      // Each job really did leave the root's group…
      expect(pgid).not.toBe(rootPgid);
      // …and the tree still knows about it.
      expect(tree.pgids).toContain(pgid);
    }
  });

  it('orders pids deepest-first so a parent cannot respawn mid-kill', async () => {
    const { root, child, grandchildren } = await escapedTree();
    const { pids } = await collectProcessTree(root);

    for (const gc of grandchildren) {
      expect(pids.indexOf(gc)).toBeLessThan(pids.indexOf(child));
    }
    expect(pids.indexOf(child)).toBeLessThan(pids.indexOf(root));
    expect(pids.indexOf(root)).toBe(pids.length - 1);
  });

  it('never targets init, pid 0, the caller, or the caller’s group', async () => {
    const { root } = await escapedTree();
    const tree = await collectProcessTree(root);

    expect(tree.pids).not.toContain(0);
    expect(tree.pids).not.toContain(1);
    expect(tree.pids).not.toContain(process.pid);
    expect(tree.pgids).not.toContain(0);
    expect(tree.pgids).not.toContain(1);
    // The runner's own group must be excluded, or a teardown would kill vitest.
    expect(tree.pgids).not.toContain(ownPgid());
  });

  it('returns nothing when rooted at the caller itself or at init', async () => {
    expect((await collectProcessTree(process.pid)).pids).toEqual([]);
    expect((await collectProcessTree(1)).pids).toEqual([]);
    expect((await collectProcessTree(0)).pids).toEqual([]);
  });

  it('finds no live members for a pid that no longer exists', async () => {
    const pid = await deadPid();
    const tree = await collectProcessTree(pid);

    // NOTE: the walk echoes the requested root back even when `ps` has no row
    // for it (the caller signals it anyway, best-effort), so `pids` is [pid]
    // rather than empty. What matters is that it found no descendants, no
    // groups to signal, and nothing alive.
    expect(tree.pids.filter((p) => p !== pid)).toEqual([]);
    expect(tree.pgids).toEqual([]);
    expect(survivors(tree)).toEqual([]);
  });
});

describe('collectProcessTreeSync', () => {
  it('sees the same tree as the async variant', async () => {
    const { root } = await escapedTree();
    const async = await collectProcessTree(root);
    const sync = collectProcessTreeSync(root);

    expect([...sync.pids].sort()).toEqual([...async.pids].sort());
    expect([...sync.pgids].sort()).toEqual([...async.pgids].sort());
  });
});

describe('treeFrom / detailedTreeFrom', () => {
  it('build the same membership from one shared ps snapshot', async () => {
    const { root } = await escapedTree();
    // One snapshot, two views — the session tracker walks many roots per `ps`.
    const rows = await snapshotAll();
    const tree = treeFrom(rows, root);
    const detailed = detailedTreeFrom(rows, root);

    expect(detailed.members.map((m) => m.pid)).toEqual(tree.pids);
    expect(detailed.pgids).toEqual(tree.pgids);
    for (const member of detailed.members) {
      // The command is what makes a remembered pid safe to kill later.
      expect(member.command.length).toBeGreaterThan(0);
    }
    expect(
      detailed.members.map((m) => m.command).filter((c) => c.includes('sleep 30')).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('mergeTrees', () => {
  it('dedupes while preserving the first tree’s ordering', () => {
    const a: ProcessTree = { pids: [30, 20, 10], pgids: [30, 10] };
    const b: ProcessTree = { pids: [20, 40], pgids: [10, 50] };

    expect(mergeTrees(a, b)).toEqual({ pids: [30, 20, 10, 40], pgids: [30, 10, 50] });
  });

  it('handles empty inputs on either side', () => {
    const a: ProcessTree = { pids: [7], pgids: [7] };
    expect(mergeTrees(a, { pids: [], pgids: [] })).toEqual(a);
    expect(mergeTrees({ pids: [], pgids: [] }, a)).toEqual(a);
  });
});

describe('signalTree / survivors', () => {
  it('kills the escaped grandchildren, not just the root group', async () => {
    const { root, grandchildren } = await escapedTree();
    const tree = await collectProcessTree(root);

    expect(survivors(tree).length).toBeGreaterThanOrEqual(3);
    for (const gc of grandchildren) expect(alive(gc)).toBe(true);

    signalTree(tree, 'SIGKILL');
    for (let i = 0; i < 100 && survivors(tree).length > 0; i++) await sleep(25);

    expect(survivors(tree)).toEqual([]);
    // The whole point: a job in its own process group dies too.
    for (const gc of grandchildren) expect(alive(gc)).toBe(false);
    expect(alive(root)).toBe(false);
  });

  it('reaches an escaped job through the group set alone', async () => {
    // Signal ONLY the groups, with no per-pid fallback. This is what fails if
    // the escaped-group discovery regresses: the old teardown knew just the
    // root's group, so the `set -m` jobs would still be alive at the end.
    const { root, grandchildren } = await escapedTree();
    const tree = await collectProcessTree(root);

    signalTree({ pids: [], pgids: tree.pgids }, 'SIGKILL');
    for (let i = 0; i < 100 && survivors(tree).length > 0; i++) await sleep(25);

    expect(survivors(tree)).toEqual([]);
    for (const gc of grandchildren) expect(alive(gc)).toBe(false);
  });

  it('never throws on an empty tree or on pids that are already dead', async () => {
    const pid = await deadPid();

    expect(() => signalTree({ pids: [], pgids: [] }, 'SIGKILL')).not.toThrow();
    expect(() => signalTree({ pids: [pid], pgids: [pid] }, 'SIGTERM')).not.toThrow();
    expect(() => signalTree({ pids: [pid], pgids: [pid] }, 'SIGKILL')).not.toThrow();
    expect(survivors({ pids: [pid], pgids: [pid] })).toEqual([]);
  });

  it('refuses to signal the caller or init even when asked to', () => {
    // A malformed/recycled record must not be able to take orckit down.
    expect(() => signalTree({ pids: [process.pid, 1, 0], pgids: [] }, 'SIGKILL')).not.toThrow();
    expect(alive(process.pid)).toBe(true);
    expect(survivors({ pids: [process.pid, 1, 0], pgids: [] })).toEqual([]);
  });
});
