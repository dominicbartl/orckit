/**
 * Mirror of orckit's `ProcessState`. Kept as a local copy so the frontend
 * can build without depending on the cli package — the values are part of
 * the public event API so drift would surface as a type error in the
 * server-side serializer, not as a silent skew at runtime.
 */
export type ProcessState =
  | 'pending'
  | 'starting'
  | 'ready'
  | 'running'
  | 'finished'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type Stream = 'stdout' | 'stderr';

/**
 * Mirror of orckit's `BuildStatus` (src/process/parsers.ts). The reduced,
 * current state of a process's most recent build, streamed over SSE for
 * processes whose `type` has a build parser (webpack, angular, …).
 */
export type BuildStatus =
  | { phase: 'building'; percent?: number }
  | { phase: 'done'; success: boolean; errors: number; warnings: number; durationMs?: number }
  | { phase: 'failed'; reason?: string };

export interface OutputLine {
  text: string;
  stream: Stream;
  timestamp: number;
  highlight?: string;
}

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
   * Absolute working directory the process runs in. Relative file references in
   * its output are resolved against this before building IDE deep links.
   */
  cwd: string;
  lastError?: string;
  build?: BuildStatus;
  /**
   * Diagnostic lines from the latest failing build. Seeded from the snapshot
   * and accumulated client-side as build:failed deltas arrive (each carries one
   * error line as `reason`); cleared on a rebuild or a successful completion.
   */
  buildErrors?: string[];
}

/**
 * Mirror of orckit's `IdeLink` (src/web/ide.ts). Present when a JetBrains
 * project was detected; lets the UI turn file references in output into
 * `jetbrains://` deep links via {@link buildIdeHref}.
 */
export interface IdeLink {
  /** JetBrains Toolbox toolTag, e.g. `web-storm`. */
  toolTag: string;
  /** IDE project name. */
  project: string;
  /** Absolute project root, for relativizing absolute paths in output. */
  root: string;
}

export interface OrckitSnapshot {
  project: string;
  processes: ProcessSnapshot[];
  ide: IdeLink | null;
}
