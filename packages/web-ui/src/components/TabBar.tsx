import { type JSX, For } from 'solid-js';
import { cx } from '../lib/cx';

export interface Tab {
  id: string;
  label: JSX.Element;
  badge?: JSX.Element;
}

export function TabBar(props: {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
  class?: string;
}) {
  return (
    <div
      role="tablist"
      class={cx(
        'inline-flex items-center gap-1 p-1 rounded-md',
        'bg-surface-inset border border-border-subtle',
        props.class,
      )}
    >
      <For each={props.tabs}>
        {(tab) => {
          const isActive = () => tab.id === props.active;
          return (
            <button
              type="button"
              role="tab"
              aria-selected={isActive()}
              onClick={() => props.onChange(tab.id)}
              class={cx(
                'inline-flex items-center gap-1.5 h-6 px-2.5 rounded text-[12px] font-medium',
                'transition-colors duration-100',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                isActive()
                  ? 'bg-surface-2 text-fg-primary shadow-soft'
                  : 'text-fg-tertiary hover:text-fg-secondary',
              )}
            >
              {tab.label}
              {tab.badge}
            </button>
          );
        }}
      </For>
    </div>
  );
}
