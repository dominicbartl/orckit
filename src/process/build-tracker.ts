import type { Orckit } from '../orchestrator/orchestrator.js';
import { reduceBuild, type BuildEvent, type BuildStatus } from './parsers.js';

/** Cap on accumulated diagnostic lines per failing build (same as the web UI). */
const MAX_BUILD_ERRORS = 50;

/**
 * Live view of where every process's most recent build stands, kept current by
 * subscribing to `process:build` / `process:restarting`. Both the web server
 * and the MCP server consume this so the two never drift on how a build outcome
 * is reduced from the raw event stream.
 *
 * The maps are exposed read-only and mutate in place — hold the tracker and read
 * `builds` / `buildErrors` whenever you need the current picture (e.g. when
 * building a snapshot), rather than caching their contents.
 */
export interface BuildTracker {
  /** Latest reduced build status per process. Absent until the first build event. */
  readonly builds: ReadonlyMap<string, BuildStatus>;
  /** Diagnostic lines from the latest *failing* build, accumulated across events. */
  readonly buildErrors: ReadonlyMap<string, string[]>;
  /** Detach the event listeners. */
  dispose(): void;
}

/**
 * Apply one build event to the running `builds` / `buildErrors` maps. Pure over
 * its inputs (mutates the passed maps) so the wait-loop in the MCP server can
 * reuse the exact same accumulation rules while it long-polls.
 */
export function applyBuildEvent(
  name: string,
  event: BuildEvent,
  builds: Map<string, BuildStatus>,
  buildErrors: Map<string, string[]>,
): void {
  builds.set(name, reduceBuild(event));
  if (event.type === 'build:start') {
    // A new compile cycle supersedes the previous failure's diagnostics.
    buildErrors.delete(name);
  } else if (event.type === 'build:complete' && event.success) {
    buildErrors.delete(name);
  } else if (event.type === 'build:failed' && event.reason) {
    const list = buildErrors.get(name) ?? [];
    if (list.length < MAX_BUILD_ERRORS) list.push(event.reason);
    buildErrors.set(name, list);
  }
}

export function trackBuilds(orckit: Orckit): BuildTracker {
  const builds = new Map<string, BuildStatus>();
  const buildErrors = new Map<string, string[]>();

  const onBuild = (name: string, event: BuildEvent) => {
    applyBuildEvent(name, event, builds, buildErrors);
  };
  // A fresh boot of the process supersedes its prior build outcome.
  const onRestarting = (name: string) => {
    builds.delete(name);
    buildErrors.delete(name);
  };

  orckit.on('process:build', onBuild);
  orckit.on('process:restarting', onRestarting);

  return {
    builds,
    buildErrors,
    dispose() {
      orckit.off('process:build', onBuild);
      orckit.off('process:restarting', onRestarting);
    },
  };
}
