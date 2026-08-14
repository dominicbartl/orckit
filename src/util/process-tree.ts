import { execFile, execFileSync } from 'node:child_process';

export interface ProcessTree {
  /** Every descendant pid (including `root`), deepest-first. */
  pids: number[];
  /**
   * Every distinct process-group id found in the tree, excluding the caller's
   * own group. A child that ran `set -m` (bash monitor mode) or `setsid` leads
   * its own group, so signalling the root's group alone would miss it.
   */
  pgids: number[];
}

export interface PsRow {
  pid: number;
  ppid: number;
  pgid: number;
  /** Full command line. Empty when the snapshot was taken without it. */
  command: string;
}

function parseRows(stdout: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of (stdout ?? '').split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    const pgid = Number(parts[2]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !Number.isInteger(pgid)) continue;
    rows.push({ pid, ppid, pgid, command: parts.slice(3).join(' ') });
  }
  return rows;
}

/**
 * One `ps` snapshot of every process on the machine, with command lines.
 * Exposed so a caller that needs several trees (the session tracker walks one
 * per managed process) pays for a single `ps` instead of one per root.
 */
export function snapshotAll(): Promise<PsRow[]> {
  return new Promise((resolve) => {
    execFile(
      'ps',
      ['-axo', 'pid=,ppid=,pgid=,command='],
      { maxBuffer: 16 * 1024 * 1024 },
      (_err, stdout) => resolve(parseRows(stdout ?? '')),
    );
  });
}

function snapshot(): Promise<PsRow[]> {
  return snapshotAll();
}

function buildTree(root: number, rows: PsRow[]): ProcessTree {
  const childrenOf = new Map<number, number[]>();
  const pgidOf = new Map<number, number>();
  for (const row of rows) {
    const siblings = childrenOf.get(row.ppid);
    if (siblings) siblings.push(row.pid);
    else childrenOf.set(row.ppid, [row.pid]);
    pgidOf.set(row.pid, row.pgid);
  }

  const ownPgid = pgidOf.get(process.pid);
  const pids: number[] = [];
  const seen = new Set<number>();
  const walk = (pid: number) => {
    if (seen.has(pid) || pid <= 1 || pid === process.pid) return;
    seen.add(pid);
    for (const child of childrenOf.get(pid) ?? []) walk(child);
    // Push after recursing so children precede parents: signalling deepest
    // first means a parent can't reap-and-respawn while we're still working.
    pids.push(pid);
  };
  walk(root);

  const pgids = new Set<number>();
  for (const pid of pids) {
    const pgid = pgidOf.get(pid);
    if (pgid == null || pgid <= 1) continue;
    if (ownPgid != null && pgid === ownPgid) continue;
    pgids.add(pgid);
  }

  return { pids, pgids: [...pgids] };
}

/**
 * The full descendant tree of `root`, captured from ONE `ps` snapshot.
 *
 * This must be taken **before** any signal is sent. Killing a parent first and
 * walking `ppid` afterwards (what `tree-kill` does) loses the whole subtree:
 * the moment the parent dies its children reparent to init, so the walk finds
 * nothing and they survive as orphans. Capturing first makes the set of
 * targets immune to the reparenting the signals themselves cause.
 *
 * Also returns the distinct process groups in the tree, because a wrapper
 * script that runs `set -m` (bash monitor mode — common in dev scripts) puts
 * each job in its own group that the root's group signal never reaches.
 *
 * The caller's own pid, its group, and pid 1 are always excluded: this
 * function's output is fed straight to `kill`, so it must never be able to
 * target orckit itself or init.
 */
export async function collectProcessTree(root: number): Promise<ProcessTree> {
  return buildTree(root, await snapshot());
}

/** Build a tree from an already-taken {@link snapshotAll} table. */
export function treeFrom(rows: PsRow[], root: number): ProcessTree {
  return buildTree(root, rows);
}

/**
 * The tree of `root` as (pid, command) pairs plus its process groups.
 *
 * Recording the command alongside each pid is what makes killing a remembered
 * tree safe later: PIDs are recycled, so a member is only ever signalled if the
 * process living under that pid still runs the command we saw.
 */
export function detailedTreeFrom(
  rows: PsRow[],
  root: number,
): { members: Array<{ pid: number; command: string }>; pgids: number[] } {
  const tree = buildTree(root, rows);
  const commandOf = new Map(rows.map((r) => [r.pid, r.command]));
  return {
    members: tree.pids.map((pid) => ({ pid, command: commandOf.get(pid) ?? '' })),
    pgids: tree.pgids,
  };
}

/**
 * Blocking variant of {@link collectProcessTree}, for the emergency paths
 * (double Ctrl-C, uncaughtException) that must finish before `process.exit()`
 * and cannot await. Returns just the root on any failure — the caller still
 * signals that, so a broken `ps` degrades to the old behavior instead of
 * throwing inside a crash handler.
 */
export function collectProcessTreeSync(root: number): ProcessTree {
  try {
    const stdout = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,command='], {
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 3_000,
    });
    return buildTree(root, parseRows(stdout));
  } catch {
    return { pids: [root], pgids: [root] };
  }
}

/** Merge two snapshots, preserving the deepest-first ordering of `a`. */
export function mergeTrees(a: ProcessTree, b: ProcessTree): ProcessTree {
  const pids = [...new Set([...a.pids, ...b.pids])];
  const pgids = [...new Set([...a.pgids, ...b.pgids])];
  return { pids, pgids };
}

/**
 * Signal every process group in the tree, then every individual pid. Groups
 * first because that reaches processes forked between the snapshot and now;
 * the per-pid pass then catches anything whose group we somehow missed.
 * Best-effort throughout — an already-dead pid is a success, not an error.
 */
export function signalTree(tree: ProcessTree, signal: NodeJS.Signals): void {
  for (const pgid of tree.pgids) {
    try {
      process.kill(-pgid, signal);
    } catch {
      // group already gone, or not permitted
    }
  }
  for (const pid of tree.pids) {
    if (pid <= 1 || pid === process.pid) continue;
    try {
      process.kill(pid, signal);
    } catch {
      // already exited
    }
  }
}

/** The subset of `tree.pids` that is still alive. */
export function survivors(tree: ProcessTree): number[] {
  return tree.pids.filter((pid) => {
    if (pid <= 1 || pid === process.pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // EPERM: exists but not ours to signal — still a survivor worth reporting.
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  });
}
