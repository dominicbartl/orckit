import { Index, Show, createSignal, onCleanup, createEffect, type JSX } from 'solid-js';
import { cx } from '../lib/cx';
import { IconCheck } from '../lib/icons';

export interface MultiSelectOption {
  value: string;
  /** Shown instead of `value`. */
  label?: string;
  /** How many items carry this value (shown right-aligned). */
  count?: number;
  /** Tooltip, e.g. the full name behind a shortened label. */
  title?: string;
}

/**
 * A facet filter: a compact button that opens a checklist of values with
 * counts. `selected` is `null` for "all" — so values that appear later are
 * included automatically — or the explicit set of values to keep. Each option
 * has an "only" shortcut; a filter box appears once the list gets long.
 */
export function MultiSelect(props: {
  label: string;
  options: MultiSelectOption[];
  selected: ReadonlySet<string> | null;
  onChange: (next: Set<string> | null) => void;
  class?: string;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  let root: HTMLDivElement | undefined;

  const isOn = (value: string) => props.selected === null || props.selected.has(value);

  const summary = (): string => {
    const sel = props.selected;
    if (sel === null) return 'all';
    if (sel.size === 0) return 'none';
    if (sel.size === 1) {
      const [only] = sel;
      const opt = props.options.find((o) => o.value === only);
      return opt?.label ?? only!;
    }
    return `${sel.size} of ${props.options.length}`;
  };

  const set = (next: Set<string>) => {
    // Every option ticked is "all" again, which also keeps future values.
    props.onChange(props.options.every((o) => next.has(o.value)) ? null : next);
  };

  const toggle = (value: string) => {
    const next = new Set(props.selected ?? props.options.map((o) => o.value));
    if (next.has(value)) next.delete(value);
    else next.add(value);
    set(next);
  };

  const visible = () => {
    const q = query().trim().toLowerCase();
    if (!q) return props.options;
    return props.options.filter((o) => `${o.label ?? ''} ${o.value}`.toLowerCase().includes(q));
  };

  // Close on an outside click or Escape while open.
  createEffect(() => {
    if (!open()) return;
    const onDown = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    });
  });

  return (
    <div ref={root} class={cx('relative', props.class)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open()}
        onClick={() => setOpen((o) => !o)}
        class={cx(
          'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs',
          'transition-colors duration-100',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          props.selected === null
            ? 'bg-surface-1 border-border-default text-fg-secondary hover:bg-surface-2'
            : 'bg-accent/10 border-accent/40 text-accent hover:bg-accent/15',
        )}
      >
        <span class="text-fg-tertiary">{props.label}</span>
        <span class="font-medium max-w-[10rem] truncate">{summary()}</span>
        <span class="text-[9px] text-fg-tertiary">▾</span>
      </button>

      <Show when={open()}>
        <div
          role="listbox"
          aria-multiselectable="true"
          class={cx(
            'absolute left-0 top-full mt-1 z-30 w-64 max-h-80 flex flex-col',
            'rounded-md border border-border-default bg-surface-1 shadow-lift',
          )}
        >
          <div class="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-border-subtle text-[11px]">
            <span class="text-fg-tertiary uppercase tracking-wider font-mono">{props.label}</span>
            <span class="flex gap-2">
              <TextAction onClick={() => props.onChange(null)}>all</TextAction>
              <TextAction onClick={() => props.onChange(new Set())}>none</TextAction>
            </span>
          </div>
          <Show when={props.options.length > 8}>
            <input
              type="text"
              placeholder="filter…"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              class={cx(
                'mx-2 mt-2 h-7 px-2 rounded border border-border-default bg-surface-inset',
                'text-xs text-fg-primary placeholder:text-fg-disabled',
                'focus:outline-none focus:ring-2 focus:ring-accent/50',
              )}
            />
          </Show>
          <div class="overflow-y-auto py-1">
            {/* Index, not For: counts change with every live batch, which rebuilds the
                option objects. For would remount each row (losing hover mid-click). */}
            <Index
              each={visible()}
              fallback={<div class="px-3 py-2 text-xs text-fg-tertiary">no values yet</div>}
            >
              {(item) => {
                const opt = () => item();
                return (
                  <div
                    role="option"
                    aria-selected={isOn(opt().value)}
                    title={opt().title}
                    onClick={() => toggle(opt().value)}
                    class="group/opt flex items-center gap-2 px-2.5 py-1 text-xs cursor-pointer hover:bg-surface-2"
                  >
                    <span
                      class={cx(
                        'h-3.5 w-3.5 flex-shrink-0 rounded-sm border flex items-center justify-center',
                        isOn(opt().value)
                          ? 'bg-accent border-accent text-fg-on-accent'
                          : 'border-border-strong',
                      )}
                    >
                      <Show when={isOn(opt().value)}>
                        <IconCheck width={10} height={10} stroke-width="3" />
                      </Show>
                    </span>
                    <span class="flex-1 min-w-0 truncate font-mono text-fg-primary">
                      {opt().label ?? opt().value}
                    </span>
                    <TextAction
                      class="hidden group-hover/opt:inline"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onChange(new Set([opt().value]));
                      }}
                    >
                      only
                    </TextAction>
                    <Show when={opt().count !== undefined}>
                      <span class="text-fg-tertiary tabular-nums font-mono">{opt().count}</span>
                    </Show>
                  </div>
                );
              }}
            </Index>
          </div>
        </div>
      </Show>
    </div>
  );
}

function TextAction(props: {
  onClick: (e: MouseEvent) => void;
  children: JSX.Element;
  class?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => props.onClick(e)}
      class={cx('text-[11px] text-accent hover:text-accent-bright', props.class)}
    >
      {props.children}
    </button>
  );
}
