import { type JSX, Show } from 'solid-js';
import { cx } from '../lib/cx';

export function EmptyState(props: {
  icon?: JSX.Element;
  title: JSX.Element;
  description?: JSX.Element;
  action?: JSX.Element;
  class?: string;
}) {
  return (
    <div
      class={cx(
        'flex flex-col items-center justify-center text-center py-10 px-6',
        'text-fg-tertiary',
        props.class,
      )}
    >
      <Show when={props.icon}>
        <div class="mb-3 text-fg-disabled">{props.icon}</div>
      </Show>
      <div class="text-sm font-medium text-fg-secondary">{props.title}</div>
      <Show when={props.description}>
        <div class="text-xs text-fg-tertiary mt-1 max-w-sm">{props.description}</div>
      </Show>
      <Show when={props.action}>
        <div class="mt-4">{props.action}</div>
      </Show>
    </div>
  );
}
