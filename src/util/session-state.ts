import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  mergeTrees,
  signalTree,
  snapshotAll,
  survivors,
  treeFrom,
  type ProcessTree,
} from './process-tree.js';

/**
 * One process orckit spawned, persisted so a LATER `orc start` can find it if
 * this orckit never got to clean up.
 *
 * Every other teardown path (Ctrl-C, SIGHUP, crash handlers) reaps children
 * from inside the running process. The one case none of them cover is orckit
 * itself being SIGKILLed — force-quit, OOM killer, `kill -9` — where no handler
 * runs at all and the detached process groups simply keep going. This file is
 * what makes those recoverable instead of invisible.
 */
export interface SessionRecord {
  name: string;
  pid: number;
  /** Process-group id (equal to pid — children are spawned detached). */
  pgid: number;
  /** The command line as spawned; used to guard against PID reuse. */
  command: string;
  /**
   * The process's descendants at the last refresh, each with the command it was
   * running. Recorded because the processes that actually strand themselves are
   * usually *grandchildren* — a Firebase functions runtime, an `ng serve`
   * worker — which reparent to init when their intermediate parent dies and are
   * then unreachable from `pid` alone. Commands are stored so a recycled PID is
   * never mistaken for a survivor.
   */
  members?: Array<{ pid: number; command: string }>;
  /** Process groups seen in the tree (a `set -m` script leads its own). */
  pgids?: number[];
}

export interface SessionFile {
  /** PID of the `orc start` process that owns these records. */
  orckitPid: number;
  project: string;
  startedAt: number;
  processes: SessionRecord[];
}

const FILE_NAME = 'session.json';

export function sessionFilePath(dir: string): string {
  return join(dir, FILE_NAME);
}

/**
 * Persist the current set of live children. Best-effort: a read-only or
 * missing directory must never break a boot, so every failure is swallowed.
 */
export function writeSession(dir: string, session: SessionFile): void {
  try {
    mkdirSync(dirname(sessionFilePath(dir)), { recursive: true });
    writeFileSync(sessionFilePath(dir), JSON.stringify(session, null, 2));
  } catch {
    // state tracking is a convenience, never a hard requirement
  }
}

export function readSession(dir: string): SessionFile | null {
  try {
    const parsed = JSON.parse(readFileSync(sessionFilePath(dir), 'utf-8')) as SessionFile;
    if (!Array.isArray(parsed.processes) || typeof parsed.orckitPid !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(dir: string): void {
  try {
    rmSync(sessionFilePath(dir), { force: true });
  } catch {
    // nothing to clean up
  }
}

/** True when `pid` exists and we may signal it. */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM => the pid exists but belongs to another user; treat as alive so we
    // never silently ignore a real survivor (the kill below will just fail).
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function currentCommand(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('ps', ['-p', String(pid), '-o', 'command='], (_err, stdout) => {
      const line = (stdout ?? '').trim();
      resolve(line === '' ? null : line);
    });
  });
}

/**
 * Records from a previous session whose process is STILL RUNNING and still
 * looks like the process we recorded.
 *
 * The identity check matters: PIDs are recycled, and a stale record must never
 * become a license to kill an unrelated process. A survivor counts only when
 * the live pid's current command line still matches what we recorded, so a
 * recycled pid running something else is dropped.
 */
export async function findSurvivors(session: SessionFile): Promise<SessionRecord[]> {
  const found: SessionRecord[] = [];
  for (const record of session.processes) {
    // A record counts as surviving when EITHER its own process is still there
    // or any of its recorded descendants is — the common real-world case is the
    // direct child being gone while an escaped grandchild keeps running (and
    // keeps a port bound).
    const live: Array<{ pid: number; command: string }> = [];
    for (const member of [
      { pid: record.pid, command: record.command },
      ...(record.members ?? []),
    ]) {
      if (live.some((m) => m.pid === member.pid)) continue;
      if (!isAlive(member.pid)) continue;
      const current = await currentCommand(member.pid);
      if (current == null || !commandsMatch(member.command, current)) continue;
      live.push(member);
    }
    if (live.length === 0) continue;
    found.push({ ...record, members: live });
  }
  return found;
}

/** How many live processes a survivor record actually covers. */
export function survivorSize(record: SessionRecord): number {
  return Math.max(1, record.members?.length ?? 1);
}

/**
 * Whether a live `ps` command line is plausibly the one we recorded. Orckit
 * spawns through `bash -c <command>`, and `ps` renders that differently across
 * platforms (and truncates long lines), so an exact match is too strict —
 * containment either way is the right test.
 */
export function commandsMatch(recorded: string, live: string): boolean {
  const a = recorded.replace(/\s+/g, ' ').trim();
  const b = live.replace(/\s+/g, ' ').trim();
  if (a === '' || b === '') return false;
  return a.includes(b) || b.includes(a);
}

/**
 * SIGTERM everything a recorded survivor still has running, then SIGKILL
 * whatever is left after `graceMs`. Returns true once nothing remains.
 *
 * Every target is re-verified against its recorded command HERE, at the kill
 * site, rather than trusting the record. The record can legitimately survive on
 * the strength of one descendant while its root PID has been recycled by an
 * unrelated program — signalling `record.pid`, let alone its whole process
 * group, would then kill a stranger. Only PIDs that still run what we recorded,
 * the groups those PIDs currently lead, and their live descendants are touched.
 */
export async function killSurvivor(record: SessionRecord, graceMs = 5000): Promise<boolean> {
  const candidates = [{ pid: record.pid, command: record.command }, ...(record.members ?? [])];
  const rows = await snapshotAll();
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const ownPgid = byPid.get(process.pid)?.pgid;

  const verified: number[] = [];
  const pgids = new Set<number>();
  for (const candidate of candidates) {
    if (candidate.pid <= 1 || candidate.pid === process.pid) continue;
    const row = byPid.get(candidate.pid);
    if (!row || !commandsMatch(candidate.command, row.command)) continue;
    verified.push(candidate.pid);
    if (row.pgid > 1 && row.pgid !== ownPgid) pgids.add(row.pgid);
  }
  if (verified.length === 0) return true;

  // Descendants of a verified process are ours by definition — this picks up
  // anything spawned since the session file's last refresh.
  let tree: ProcessTree = { pids: verified, pgids: [...pgids] };
  for (const pid of verified) tree = mergeTrees(tree, treeFrom(rows, pid));

  signalTree(tree, 'SIGTERM');
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (survivors(tree).length === 0) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  signalTree(tree, 'SIGKILL');
  const killDeadline = Date.now() + 1500;
  while (Date.now() < killDeadline) {
    if (survivors(tree).length === 0) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return survivors(tree).length === 0;
}
