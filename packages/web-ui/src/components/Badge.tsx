import { type JSX } from 'solid-js';
import { cx } from '../lib/cx';
import type { ProcessState } from '../lib/types';
import { StatusDot } from './StatusDot';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const TONE: Record<Tone, string> = {
  neutral:
    'bg-surface-2 text-fg-secondary border-border-default',
  accent:
    'bg-accent/15 text-accent border-accent/30',
  success:
    'bg-status-ready/15 text-status-ready border-status-ready/30',
  warning:
    'bg-status-starting/15 text-status-starting border-status-starting/30',
  danger:
    'bg-status-failed/15 text-status-failed border-status-failed/30',
  info:
    'bg-status-finished/15 text-status-finished border-status-finished/30',
};

const STATE_TONE: Record<ProcessState, Tone> = {
  pending: 'neutral',
  starting: 'warning',
  ready: 'success',
  running: 'success',
  finished: 'info',
  stopping: 'warning',
  stopped: 'neutral',
  failed: 'danger',
};

export function Badge(props: {
  tone?: Tone;
  children: JSX.Element;
  class?: string;
}) {
  return (
    <span
      class={cx(
        'inline-flex items-center gap-1 px-1.5 py-0.5',
        'text-[11px] leading-none font-mono uppercase tracking-wider',
        'rounded-sm border',
        TONE[props.tone ?? 'neutral'],
        props.class,
      )}
    >
      {props.children}
    </span>
  );
}

export function StateBadge(props: { state: ProcessState; class?: string }) {
  return (
    <Badge tone={STATE_TONE[props.state]} class={props.class}>
      <StatusDot state={props.state} size="sm" />
      {props.state}
    </Badge>
  );
}
