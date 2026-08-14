import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
  const survivors: SessionRecord[] = [];
  for (const record of session.processes) {
    if (!isAlive(record.pid)) continue;
    const live = await currentCommand(record.pid);
    if (live == null) continue;
    if (!commandsMatch(record.command, live)) continue;
    survivors.push(record);
  }
  return survivors;
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
 * SIGTERM a survivor's whole process group, then SIGKILL anything left after
 * `graceMs`. Returns true when the group is gone.
 */
export async function killSurvivor(record: SessionRecord, graceMs = 5000): Promise<boolean> {
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-record.pgid, signal);
    } catch {
      // group already gone
    }
    try {
      process.kill(record.pid, signal);
    } catch {
      // process already gone
    }
  };

  signalGroup('SIGTERM');
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isAlive(record.pid)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  signalGroup('SIGKILL');
  const killDeadline = Date.now() + 1500;
  while (Date.now() < killDeadline) {
    if (!isAlive(record.pid)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !isAlive(record.pid);
}
