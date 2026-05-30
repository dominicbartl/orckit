import { type JSX, Show } from 'solid-js';
import { cx } from '../lib/cx';
import type { ProcessSnapshot } from '../lib/types';
import { Badge, StateBadge } from './Badge';
import { BuildBadge } from './BuildBadge';
import { IconButton } from './IconButton';
import { IconRestart, IconStop, IconPlay, IconChevron } from '../lib/icons';

export interface ProcessRowProps {
  process: ProcessSnapshot;
  selected?: boolean;
  onSelect?: () => void;
  onStart?: () => void;
  onRestart?: () => void;
  onStop?: () => void;
  trailing?: JSX.Element;
  class?: string;
}

export function ProcessRow(props: ProcessRowProps) {
  const canStop = () => ['starting', 'ready', 'running'].includes(props.process.state);
  const canRestart = () => props.process.state !== 'pending';
  // An optional or stopped process can be started. Pending == hasn't run yet.
  const canStart = () =>
    ['pending', 'stopped', 'failed', 'finished'].includes(props.process.state);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onSelect?.();
        }
      }}
      class={cx(
        'group flex items-center gap-3 px-3 py-2.5',
        'border-b border-border-subtle last:border-0',
        'cursor-pointer transition-colors duration-75',
        props.selected
          ? 'bg-surface-2'
          : 'hover:bg-surface-1/60',
        props.class,
      )}
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="font-mono text-[13px] font-medium text-fg-primary truncate">
            {props.process.name}
          </span>
          <StateBadge state={props.process.state} />
          <Show when={props.process.build}>
            <BuildBadge build={props.process.build!} />
          </Show>
          <Show when={props.process.optional}>
            <Badge tone="neutral">optional</Badge>
          </Show>
          <Show when={props.process.retries > 0}>
            <span class="text-[10px] uppercase tracking-wider font-mono text-fg-tertiary">
              retry ×{props.process.retries}
            </span>
          </Show>
        </div>
        <div class="mt-0.5 text-[11px] text-fg-tertiary truncate font-mono">
          {props.process.command}
        </div>
        <Show when={props.process.lastError}>
          <div class="mt-1 text-[11px] text-status-failed truncate font-mono">
            {props.process.lastError}
          </div>
        </Show>
      </div>

      <div
        class={cx(
          'flex items-center gap-1 transition-opacity',
          // Pending-optional rows always show controls so the user can find
          // the ▶ start button without hovering each row to discover it.
          props.selected || (props.process.optional && props.process.state === 'pending')
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100',
        )}
      >
        <Show when={props.onStart && canStart()}>
          <IconButton
            size="sm"
            variant="ghost"
            label="start"
            onClick={(e) => {
              e.stopPropagation();
              props.onStart?.();
            }}
          >
            <IconPlay width={14} height={14} />
          </IconButton>
        </Show>
        <Show when={props.onRestart && !canStart()}>
          <IconButton
            size="sm"
            variant="ghost"
            label="restart"
            disabled={!canRestart()}
            onClick={(e) => {
              e.stopPropagation();
              props.onRestart?.();
            }}
          >
            <IconRestart width={14} height={14} />
          </IconButton>
        </Show>
        <Show when={props.onStop && canStop()}>
          <IconButton
            size="sm"
            variant="ghost"
            label="stop"
            onClick={(e) => {
              e.stopPropagation();
              props.onStop?.();
            }}
          >
            <IconStop width={14} height={14} />
          </IconButton>
        </Show>
        {props.trailing}
        <span class="text-fg-disabled ml-1">
          <IconChevron width={14} height={14} />
        </span>
      </div>
    </div>
  );
}
