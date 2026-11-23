import { resolve } from 'node:path';
import type { Orckit } from '../orchestrator/orchestrator.js';
import type { ProcessState } from '../orchestrator/lifecycle.js';
import type { OutputLine } from '../process/output.js';
import type { BuildStatus } from '../process/parsers.js';
import type { ParsedLogState, ParsedLogTracker } from '../logs/tracker.js';
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
  /** Where the process is reachable in a browser (already rewritten for a sandbox), or null. */
  url: string | null;
  lastError?: string;
  /** Latest build status, for processes whose `type` has a build parser. */
  build?: BuildStatus;
  /** Diagnostic lines from the latest failing build, if any. Cleared on rebuild/success. */
  buildErrors?: string[];
  /** Present when the process has `parsed_logs`; entries come from `/api/logs/:name`. */
  parsedLogs?: ParsedLogsSnapshot;
}

export interface ParsedLogsSnapshot {
  state: ParsedLogState;
  /** Connection the entries belong to; SSE `parsed:*` events carry it too. */
  generation: number;
  /** Entries currently kept. */
  count: number;
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
  /** Maps a process URL to the one the browser can reach. Identity when omitted. */
  publicUrl?: (url: string) => string;
  /** Parsed log sources, when any process has `parsed_logs`. */
  parsedLogs?: ParsedLogTracker | null;
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
      url: inspect.url != null ? (ctx.publicUrl?.(inspect.url) ?? inspect.url) : null,
      lastError: ctx.lastErrors.get(name),
      build: ctx.builds.get(name),
      buildErrors: ctx.buildErrors.get(name),
      parsedLogs: parsedLogsSnapshot(ctx.parsedLogs, name),
    });
  }
  return {
    project: orckit.projectName,
    processes,
    ide: ctx.ide,
  };
}

function parsedLogsSnapshot(
  tracker: ParsedLogTracker | null | undefined,
  name: string,
): ParsedLogsSnapshot | undefined {
  const state = tracker?.state(name);
  if (!tracker || !state) return undefined;
  return { state, generation: tracker.generation(name), count: tracker.count(name) };
}

export function recentOutput(orckit: Orckit, name: string, n = 200): OutputLine[] {
  return orckit.output(name, n);
}
