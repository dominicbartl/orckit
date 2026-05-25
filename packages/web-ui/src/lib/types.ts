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
  lastError?: string;
}

export interface OrckitSnapshot {
  project: string;
  processes: ProcessSnapshot[];
}
