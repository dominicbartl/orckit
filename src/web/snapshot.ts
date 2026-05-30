import { resolve } from 'node:path';
import type { Orckit } from '../orchestrator/orchestrator.js';
import type { ProcessState } from '../orchestrator/lifecycle.js';
import type { OutputLine } from '../process/output.js';
import type { BuildStatus } from '../process/parsers.js';
import type { IdeLink } from './ide.js';

export interface ProcessSnapshot {
  name: string;
  state: ProcessState;
  type: string;
  command: string;
  category: string;
  depends_on: string[];
  pid: number | null;
  startedAt: number | null;
  retries: number;
  optional: boolean;
  /**
   * Absolute working directory the process is spawned in (`config.cwd` resolved
   * against orckit's cwd, or orckit's cwd when unset) — mirrors what the Runner
   * passes to `spawn`. The web UI resolves relative file references in this
   * process's output against it before building IDE deep links.
   */
  cwd: string;
  lastError?: string;
  /** Latest build status, for processes whose `type` has a build parser. */
  build?: BuildStatus;
  /** Diagnostic lines from the latest failing build, if any. Cleared on rebuild/success. */
  buildErrors?: string[];
}

export interface OrckitSnapshot {
  project: string;
  processes: ProcessSnapshot[];
  /** IDE deep-link descriptor when a JetBrains project was detected; null otherwise. */
  ide: IdeLink | null;
}

export interface SnapshotContext {
  /** Last error message keyed by process name; populated by the server from process:failed events. */
  lastErrors: ReadonlyMap<string, string>;
  /** Latest build status keyed by process name; populated from process:build events. */
  builds: ReadonlyMap<string, BuildStatus>;
  /** Accumulated diagnostic lines from the latest failing build, keyed by process name. */
  buildErrors: ReadonlyMap<string, string[]>;
  /** Resolved IDE deep-link descriptor, or null when not a JetBrains project / disabled. */
  ide: IdeLink | null;
}

/**
 * Build a serializable snapshot of the orchestrator's current state. Pure
 * function over Orckit's public read API — no private access, no caching.
 */
export function buildSnapshot(orckit: Orckit, ctx: SnapshotContext): OrckitSnapshot {
  const processes: ProcessSnapshot[] = [];
  for (const [name, processConfig] of Object.entries(orckit.config.processes)) {
    const inspect = orckit.inspect(name);
    processes.push({
      name,
      state: inspect.state,
      type: processConfig.type,
      command: processConfig.command,
      category: processConfig.category,
      depends_on: processConfig.depends_on,
      pid: inspect.pid,
      startedAt: inspect.startedAt,
      retries: inspect.retries,
      optional: processConfig.optional,
      // Resolve the same way the Runner spawns: `config.cwd ?? process.cwd()`,
      // with a relative `config.cwd` taken against orckit's working directory.
      cwd: resolve(processConfig.cwd ?? '.'),
      lastError: ctx.lastErrors.get(name),
      build: ctx.builds.get(name),
      buildErrors: ctx.buildErrors.get(name),
    });
  }
  return {
    project: orckit.projectName,
    processes,
    ide: ctx.ide,
  };
}

export function recentOutput(orckit: Orckit, name: string, n = 200): OutputLine[] {
  return orckit.output(name, n);
}
