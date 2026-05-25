import type { Orckit } from '../orchestrator/orchestrator.js';
import type { ProcessState } from '../orchestrator/lifecycle.js';
import type { OutputLine } from '../process/output.js';

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
  lastError?: string;
}

export interface OrckitSnapshot {
  project: string;
  processes: ProcessSnapshot[];
}

export interface SnapshotContext {
  /** Last error message keyed by process name; populated by the server from process:failed events. */
  lastErrors: ReadonlyMap<string, string>;
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
      lastError: ctx.lastErrors.get(name),
    });
  }
  return {
    project: orckit.projectName,
    processes,
  };
}

export function recentOutput(orckit: Orckit, name: string, n = 200): OutputLine[] {
  return orckit.output(name, n);
}
