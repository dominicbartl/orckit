import type { Orckit } from '../orchestrator/orchestrator.js';
import { detailedTreeFrom, snapshotAll } from '../util/process-tree.js';
import {
  clearSession,
  writeSession,
  type SessionRecord,
  type SessionFile,
} from '../util/session-state.js';

export interface SessionTrackerOptions {
  /** Directory for the session file. Created on demand. */
  dir: string;
  /**
   * How often (ms) to re-walk each managed process's descendant tree. One `ps`
   * per interval regardless of process count. Default 15s — frequent enough
   * that a force-quit rarely loses more than the newest children, cheap enough
   * to leave running for a whole dev session.
   */
  refreshMs?: number;
}

export interface SessionTrackerHandle {
  /** Absolute-or-relative path of the session file being maintained. */
  dir: string;
  /** Stop tracking and delete the session file (a clean exit leaves nothing). */
  dispose(): void;
}

/**
 * Reporter-style consumer that keeps an on-disk record of the process groups
 * this orckit spawned, so the NEXT `orc start` can detect and reap them if this
 * one dies without running any teardown (SIGKILL, force quit, OOM killer).
 *
 * Adds a record when a process spawns, drops it when the process stops, fails
 * or finishes, and deletes the file entirely on `dispose()` — so the file
 * existing at boot means "the previous session did not exit cleanly".
 */
export function attachSessionTracker(
  orckit: Orckit,
  opts: SessionTrackerOptions,
): SessionTrackerHandle {
  const records = new Map<string, SessionRecord>();

  const flush = () => {
    const session: SessionFile = {
      orckitPid: process.pid,
      project: orckit.projectName,
      startedAt: Date.now(),
      processes: [...records.values()],
    };
    writeSession(opts.dir, session);
  };

  /**
   * Re-walk every managed process's descendants from ONE `ps` snapshot. This is
   * what makes force-quit recovery able to reach grandchildren — the Firebase
   * functions runtimes, `ng serve` workers — which reparent to init when their
   * intermediate parent dies and are then unreachable from the root pid.
   */
  const refresh = async () => {
    if (records.size === 0) return;
    const rows = await snapshotAll();
    let changed = false;
    for (const [name, record] of records) {
      const { members, pgids } = detailedTreeFrom(rows, record.pid);
      if (members.length === 0) continue;
      records.set(name, { ...record, members, pgids });
      changed = true;
    }
    if (changed) flush();
  };

  const onSpawned = (name: string, pid: number, command: string) => {
    records.set(name, { name, pid, pgid: pid, command });
    flush();
    // The tree right after spawn is just the shell; the interesting
    // descendants appear over the next seconds, which the interval picks up.
    void refresh().catch(() => {});
  };
  const onGone = (name: string) => {
    if (records.delete(name)) flush();
  };

  orckit.on('process:spawned', onSpawned);
  orckit.on('process:stopped', onGone);
  orckit.on('process:failed', onGone);
  orckit.on('process:finished', onGone);

  const timer = setInterval(() => void refresh().catch(() => {}), opts.refreshMs ?? 15_000);
  // Never hold the event loop open on account of bookkeeping.
  timer.unref();

  return {
    dir: opts.dir,
    dispose: () => {
      clearInterval(timer);
      orckit.off('process:spawned', onSpawned);
      orckit.off('process:stopped', onGone);
      orckit.off('process:failed', onGone);
      orckit.off('process:finished', onGone);
      clearSession(opts.dir);
    },
  };
}
