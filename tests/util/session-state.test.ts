import { execa } from 'execa';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearSession,
  commandsMatch,
  findSurvivors,
  isAlive,
  killSurvivor,
  readSession,
  sessionFilePath,
  survivorSize,
  writeSession,
  type SessionFile,
} from '../../src/util/session-state.js';
import { snapshotAll, detailedTreeFrom } from '../../src/util/process-tree.js';

const dirs: string[] = [];
const spawned: Array<{ kill: () => void }> = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orckit-session-'));
  dirs.push(dir);
  return dir;
}

/** A detached `sleep` in its own process group, mirroring how Runner spawns. */
async function detachedSleep(): Promise<{ pid: number; command: string }> {
  const command = 'sleep 30';
  const sub = execa('bash', ['-c', command], { detached: true, reject: false, stdin: 'ignore' });
  spawned.push({
    kill: () => {
      try {
        process.kill(-sub.pid!, 'SIGKILL');
      } catch {
        /* already gone */
      }
    },
  });
  // Give the shell a moment to be visible to `ps`.
  await new Promise((r) => setTimeout(r, 150));
  return { pid: sub.pid!, command };
}

interface StrandedTree {
  /** The recorded root — already dead by the time this resolves. */
  root: number;
  rootCommand: string;
  /** The `set -m` jobs that escaped into their own groups and are still alive. */
  escaped: Array<{ pid: number; command: string }>;
  escapedPgids: number[];
}

/**
 * The orphan shape this feature exists for: a detached tree whose grandchildren
 * ran under `set -m` (so each leads its own process group), with the ROOT then
 * killed. Nothing is reachable from the recorded pid any more — only the
 * recorded `members` still point at the survivors.
 */
async function strandedTree(): Promise<StrandedTree> {
  const rootCommand = `bash -c 'set -m; sleep 30 & sleep 30'; sleep 30`;
  const sub = execa('bash', ['-c', rootCommand], {
    detached: true,
    reject: false,
    stdin: 'ignore',
  });
  const root = sub.pid!;
  const doomedPids: number[] = [root];
  const doomedPgids: number[] = [root];
  spawned.push({
    kill: () => {
      for (const pgid of doomedPgids) {
        try {
          process.kill(-pgid, 'SIGKILL');
        } catch {
          /* group already gone */
        }
      }
      for (const pid of doomedPids) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    },
  });
  await new Promise((r) => setTimeout(r, 250));

  const rows = await snapshotAll();
  const rootPgid = rows.find((r) => r.pid === root)?.pgid;
  const { members } = detailedTreeFrom(rows, root);
  doomedPids.push(...members.map((m) => m.pid));
  const escaped = members.filter(
    (m) => m.pid !== root && rows.find((r) => r.pid === m.pid)?.pgid !== rootPgid,
  );
  const escapedPgids = [...new Set(escaped.map((m) => rows.find((r) => r.pid === m.pid)!.pgid))];
  doomedPgids.push(...escapedPgids);
  expect(escaped.length, 'set -m jobs never escaped their parent group').toBeGreaterThanOrEqual(2);

  // Kill ONLY the root. The escaped jobs reparent to init and keep running.
  // Don't await the execa promise: the survivors still hold the inherited
  // stdout pipe open, so it wouldn't settle until they exit.
  void sub.catch(() => {});
  process.kill(root, 'SIGKILL');
  for (let i = 0; i < 50 && isAlive(root); i++) await new Promise((r) => setTimeout(r, 20));
  expect(isAlive(root)).toBe(false);

  return { root, rootCommand, escaped, escapedPgids };
}

function session(processes: SessionFile['processes']): SessionFile {
  return { orckitPid: process.pid, project: 'test', startedAt: Date.now(), processes };
}

afterEach(() => {
  for (const s of spawned.splice(0)) s.kill();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('session file round-trip', () => {
  it('writes, reads back and clears', () => {
    const dir = scratch();
    const file = session([{ name: 'api', pid: 123, pgid: 123, command: 'node server.js' }]);

    writeSession(dir, file);
    expect(existsSync(sessionFilePath(dir))).toBe(true);

    const read = readSession(dir);
    expect(read?.project).toBe('test');
    expect(read?.processes).toEqual(file.processes);

    clearSession(dir);
    expect(existsSync(sessionFilePath(dir))).toBe(false);
    expect(readSession(dir)).toBeNull();
  });

  it('creates the directory on demand', () => {
    const dir = join(scratch(), 'nested', 'deeper');
    writeSession(dir, session([]));
    expect(readSession(dir)).not.toBeNull();
  });

  it('returns null for a missing, malformed or wrong-shaped file', () => {
    const dir = scratch();
    expect(readSession(dir)).toBeNull();

    writeFileSync(sessionFilePath(dir), 'not json at all');
    expect(readSession(dir)).toBeNull();

    writeFileSync(sessionFilePath(dir), JSON.stringify({ project: 'x' }));
    expect(readSession(dir)).toBeNull();
  });

  it('never throws when the target is unwritable', () => {
    expect(() => writeSession('/proc/nonexistent-orckit', session([]))).not.toThrow();
    expect(() => clearSession('/proc/nonexistent-orckit')).not.toThrow();
  });
});

describe('commandsMatch', () => {
  it('matches identical and whitespace-differing commands', () => {
    expect(commandsMatch('pnpm build:watch', 'pnpm build:watch')).toBe(true);
    expect(commandsMatch('pnpm   build:watch', 'pnpm build:watch')).toBe(true);
  });

  it('matches when ps truncates or wraps the recorded command', () => {
    // ps shows the interpreter's resolved path around the same command, and
    // truncates long lines — so containment counts in either direction.
    expect(commandsMatch('pnpm exec ng serve', 'node /usr/bin/pnpm exec ng serve')).toBe(true);
    expect(commandsMatch('node /usr/bin/pnpm exec ng serve', 'pnpm exec ng serve')).toBe(true);
    expect(commandsMatch('sleep 30', 'bash -c sleep 30')).toBe(true);
  });

  it('rejects unrelated commands — a recycled PID must not be killed', () => {
    expect(commandsMatch('pnpm build:watch', 'Google Chrome Helper')).toBe(false);
    expect(commandsMatch('sleep 30', 'postgres -D /data')).toBe(false);
  });

  it('rejects empty input on either side', () => {
    expect(commandsMatch('', 'sleep 30')).toBe(false);
    expect(commandsMatch('sleep 30', '   ')).toBe(false);
  });
});

describe('isAlive', () => {
  it('is true for this process and false for an impossible pid', () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(-1)).toBe(false);
    expect(isAlive(0)).toBe(false);
  });

  it('is false for a pid that has exited', async () => {
    const { pid } = await detachedSleep();
    expect(isAlive(pid)).toBe(true);
    process.kill(-pid, 'SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
    expect(isAlive(pid)).toBe(false);
  });
});

describe('findSurvivors', () => {
  it('finds a live process whose command still matches', async () => {
    const { pid, command } = await detachedSleep();
    const survivors = await findSurvivors(session([{ name: 'sleeper', pid, pgid: pid, command }]));
    expect(survivors.map((s) => s.pid)).toEqual([pid]);
  });

  it('ignores records whose process is gone', async () => {
    const { pid, command } = await detachedSleep();
    process.kill(-pid, 'SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
    expect(await findSurvivors(session([{ name: 'x', pid, pgid: pid, command }]))).toEqual([]);
  });

  it('ignores a recycled PID running something else', async () => {
    const { pid } = await detachedSleep();
    // Same live pid, but the recorded command is from a different program.
    const survivors = await findSurvivors(
      session([{ name: 'stale', pid, pgid: pid, command: 'postgres -D /var/lib/pg' }]),
    );
    expect(survivors).toEqual([]);
  });

  it('reports a record whose root is dead but whose members escaped', async () => {
    // THE case `members` was added for: the direct child is gone, an escaped
    // grandchild still holds the port. Walking from `pid` alone finds nothing.
    const { root, rootCommand, escaped } = await strandedTree();
    const survivors = await findSurvivors(
      session([{ name: 'api', pid: root, pgid: root, command: rootCommand, members: escaped }]),
    );

    expect(survivors).toHaveLength(1);
    expect(survivors[0].name).toBe('api');
    // The dead root is dropped; every live member is kept.
    expect(survivors[0].members?.map((m) => m.pid).sort()).toEqual(
      escaped.map((m) => m.pid).sort(),
    );
    expect(survivors[0].members?.map((m) => m.pid)).not.toContain(root);
  });

  it('drops members whose pid is alive but runs a different command', async () => {
    // PID reuse: the recorded member pid is live, but it is somebody else now.
    const { root, rootCommand, escaped } = await strandedTree();
    const survivors = await findSurvivors(
      session([
        {
          name: 'api',
          pid: root,
          pgid: root,
          command: rootCommand,
          members: escaped.map((m) => ({ pid: m.pid, command: 'postgres -D /var/lib/pg' })),
        },
      ]),
    );
    expect(survivors).toEqual([]);
  });

  it('keeps only the live members of a partially-dead tree', async () => {
    const { root, rootCommand, escaped } = await strandedTree();
    const [first, ...rest] = escaped;
    process.kill(first.pid, 'SIGKILL');
    for (let i = 0; i < 50 && isAlive(first.pid); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const survivors = await findSurvivors(
      session([{ name: 'api', pid: root, pgid: root, command: rootCommand, members: escaped }]),
    );
    expect(survivors[0].members?.map((m) => m.pid)).toEqual(rest.map((m) => m.pid));
  });
});

describe('survivorSize', () => {
  it('counts the live members findSurvivors kept', async () => {
    const { root, rootCommand, escaped } = await strandedTree();
    const survivors = await findSurvivors(
      session([{ name: 'api', pid: root, pgid: root, command: rootCommand, members: escaped }]),
    );
    expect(survivorSize(survivors[0])).toBe(escaped.length);
  });

  it('never reports less than one, even without recorded members', () => {
    const bare = { name: 'x', pid: 123, pgid: 123, command: 'sleep 30' };
    expect(survivorSize(bare)).toBe(1);
    expect(survivorSize({ ...bare, members: [] })).toBe(1);
    expect(survivorSize({ ...bare, members: [{ pid: 1234, command: 'sleep 30' }] })).toBe(1);
  });
});

describe('killSurvivor', () => {
  it('terminates the whole process group and reports success', async () => {
    const { pid, command } = await detachedSleep();
    const killed = await killSurvivor({ name: 'sleeper', pid, pgid: pid, command }, 2000);
    expect(killed).toBe(true);
    expect(isAlive(pid)).toBe(false);
  });

  it('succeeds trivially when the process is already gone', async () => {
    const { pid, command } = await detachedSleep();
    process.kill(-pid, 'SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
    expect(await killSurvivor({ name: 'x', pid, pgid: pid, command }, 500)).toBe(true);
  });

  it('kills the recorded members when the root is already gone', async () => {
    // No live ppid walk can reach these — only the recorded members and their
    // groups do, which is exactly what a stale session file has to carry.
    const { root, rootCommand, escaped, escapedPgids } = await strandedTree();
    const killed = await killSurvivor(
      {
        name: 'api',
        pid: root,
        pgid: root,
        command: rootCommand,
        members: escaped,
        pgids: escapedPgids,
      },
      2000,
    );

    expect(killed).toBe(true);
    for (const member of escaped) expect(isAlive(member.pid)).toBe(false);
  });

  it('escalates to SIGKILL for a process that ignores SIGTERM', async () => {
    // `trap '' TERM` makes the shell immune to the graceful signal.
    const command = "trap '' TERM; sleep 30";
    const sub = execa('bash', ['-c', command], { detached: true, reject: false, stdin: 'ignore' });
    const pid = sub.pid!;
    spawned.push({
      kill: () => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      },
    });
    await new Promise((r) => setTimeout(r, 200));

    const killed = await killSurvivor({ name: 'stubborn', pid, pgid: pid, command }, 700);
    expect(killed).toBe(true);
    expect(isAlive(pid)).toBe(false);
  });
});
