export type ProcessState =
  | 'pending'
  | 'starting'
  | 'ready'
  | 'running'
  | 'finished'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type LifecycleEvent =
  | { kind: 'start' }
  | { kind: 'ready' }
  | { kind: 'mark-running' }
  | { kind: 'mark-finished' }
  | { kind: 'stop-requested' }
  | { kind: 'exited'; expected: boolean; code: number | null }
  | { kind: 'fail' };

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: ProcessState,
    public readonly event: LifecycleEvent,
  ) {
    super(`illegal transition from "${from}" on event "${event.kind}"`);
    this.name = 'IllegalTransitionError';
  }
}

export function transition(state: ProcessState, event: LifecycleEvent): ProcessState {
  switch (event.kind) {
    case 'start':
      if (state === 'pending' || state === 'stopped' || state === 'failed' || state === 'finished')
        return 'starting';
      break;
    case 'ready':
      if (state === 'starting') return 'ready';
      break;
    case 'mark-running':
      if (state === 'ready') return 'running';
      break;
    case 'mark-finished':
      if (state === 'ready') return 'finished';
      break;
    case 'stop-requested':
      if (state === 'starting' || state === 'ready' || state === 'running') return 'stopping';
      break;
    case 'exited':
      if (state === 'stopping') return 'stopped';
      if (event.expected && (state === 'ready' || state === 'running')) return 'stopped';
      // Clean exit (code 0) from an active process is a clean completion, not a failure.
      // Restart policy still applies in the orchestrator (`always` will restart even on stop).
      if (event.code === 0 && (state === 'ready' || state === 'running')) return 'stopped';
      return 'failed';
    case 'fail':
      if (state === 'stopping' || state === 'stopped') return state;
      return 'failed';
  }
  throw new IllegalTransitionError(state, event);
}

export function isTerminal(state: ProcessState): boolean {
  return state === 'stopped' || state === 'failed' || state === 'finished';
}

export function isActive(state: ProcessState): boolean {
  return state === 'starting' || state === 'ready' || state === 'running';
}

/** True when the process has successfully reached a dependency-satisfying state. */
export function isReadyOrDone(state: ProcessState): boolean {
  return state === 'ready' || state === 'running' || state === 'finished';
}
