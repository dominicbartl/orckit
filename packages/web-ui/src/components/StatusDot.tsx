import { cx } from '../lib/cx';
import type { ProcessState } from '../lib/types';

const SIZES = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-2.5 w-2.5',
} as const;

const COLORS: Record<ProcessState, string> = {
  pending: 'bg-status-pending',
  starting: 'bg-status-starting pulse-dot',
  ready: 'bg-status-ready',
  running: 'bg-status-running',
  finished: 'bg-status-finished',
  stopping: 'bg-status-stopping pulse-dot',
  stopped: 'bg-status-stopped',
  failed: 'bg-status-failed',
};

export function StatusDot(props: {
  state: ProcessState;
  size?: keyof typeof SIZES;
  ring?: boolean;
  class?: string;
}) {
  return (
    <span
      class={cx(
        'inline-block rounded-full',
        SIZES[props.size ?? 'md'],
        COLORS[props.state],
        props.ring && 'ring-2 ring-current/20',
        props.class,
      )}
      aria-label={props.state}
    />
  );
}
