import { type JSX } from 'solid-js';
import { cx } from '../lib/cx';

export function Card(props: { children: JSX.Element; class?: string; padded?: boolean }) {
  return (
    <div
      class={cx(
        'bg-surface-1 border border-border-subtle rounded-lg shadow-soft',
        props.padded !== false && 'p-4',
        props.class,
      )}
    >
      {props.children}
    </div>
  );
}

export function CardHeader(props: {
  title: JSX.Element;
  subtitle?: JSX.Element;
  trailing?: JSX.Element;
  class?: string;
}) {
  return (
    <div class={cx('flex items-start justify-between gap-3 pb-3', props.class)}>
      <div class="min-w-0">
        <div class="text-sm font-medium text-fg-primary truncate">{props.title}</div>
        {props.subtitle && (
          <div class="text-xs text-fg-tertiary mt-0.5 truncate">{props.subtitle}</div>
        )}
      </div>
      {props.trailing && <div class="flex items-center gap-1.5 flex-shrink-0">{props.trailing}</div>}
    </div>
  );
}

export function SectionDivider(props: { label?: string }) {
  return (
    <div class="flex items-center gap-3 py-2">
      {props.label && (
        <div class="text-[10px] uppercase tracking-wider text-fg-tertiary font-mono">
          {props.label}
        </div>
      )}
      <div class="h-px flex-1 wave-rule opacity-60" />
    </div>
  );
}
