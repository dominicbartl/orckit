import type { Orckit } from '../orchestrator/orchestrator.js';
import {
  clearSession,
  writeSession,
  type SessionRecord,
  type SessionFile,
} from '../util/session-state.js';

export interface SessionTrackerOptions {
  /** Directory for the session file. Created on demand. */
  dir: string;
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

  const onSpawned = (name: string, pid: number, command: string) => {
    records.set(name, { name, pid, pgid: pid, command });
    flush();
  };
  const onGone = (name: string) => {
    if (records.delete(name)) flush();
  };

  orckit.on('process:spawned', onSpawned);
  orckit.on('process:stopped', onGone);
  orckit.on('process:failed', onGone);
  orckit.on('process:finished', onGone);

  return {
    dir: opts.dir,
    dispose: () => {
      orckit.off('process:spawned', onSpawned);
      orckit.off('process:stopped', onGone);
      orckit.off('process:failed', onGone);
      orckit.off('process:finished', onGone);
      clearSession(opts.dir);
    },
  };
}
