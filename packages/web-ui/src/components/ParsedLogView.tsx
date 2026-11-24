import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type Accessor,
} from 'solid-js';
import { cx } from '../lib/cx';
import { IconSearch } from '../lib/icons';
import { STATUS_CLASSES, shortFunctionName, type StatusClass } from '../lib/logValue';
import {
  DEFAULT_FILTERS,
  LEVELS,
  NO_HANDLER,
  compileFilters,
  facetCounts,
  isDefault,
  loadFilters,
  matchesFilters,
  saveFilters,
  type ParsedFilters,
} from '../lib/parsedFilter';
import type { IdeLink, ParsedLogEntry, ParsedLogState } from '../lib/types';
import { EmptyState } from './EmptyState';
import { MultiSelect } from './MultiSelect';
import { ParsedEntryRow } from './ParsedEntryRow';

interface ParsedLogViewProps {
  /** Process name, for messages. */
  name: string;
  /** Where the log source stands; undefined while the first snapshot is pending. */
  state: ParsedLogState | undefined;
  entries: Accessor<readonly ParsedLogEntry[]>;
  /** Changes on every reconnect — expanded rows are dropped with the old entries. */
  generation?: number;
  /** localStorage key for this process's filters; filters aren't saved without one. */
  storageKey?: string;
  ide?: IdeLink | null;
  baseDir?: string;
  class?: string;
}

/**
 * The structured view of a process's `parsed_logs`: one row per function
 * execution, request logs with their fields as chips, emulator lines — with
 * function / handler / level facets, status-class chips and free-text search.
 *
 * Like `LogView`, it sticks to the bottom while new entries arrive and stops
 * following once you scroll up.
 */
export function ParsedLogView(props: ParsedLogViewProps) {
  const [filters, setFiltersSignal] = createSignal<ParsedFilters>(
    props.storageKey ? loadFilters(props.storageKey) : DEFAULT_FILTERS,
  );
  const setFilters = (patch: Partial<ParsedFilters>) => {
    const next = { ...filters(), ...patch };
    setFiltersSignal(next);
    if (props.storageKey) saveFilters(props.storageKey, next);
  };

  const compiled = createMemo(() => compileFilters(filters()));
  const visible = createMemo(() => {
    const f = compiled();
    return props.entries().filter((e) => matchesFilters(e, f));
  });
  const counts = createMemo(() => facetCounts(props.entries()));

  // Only the newest matches are in the DOM: with a full 5,000-entry buffer,
  // clearing a filter re-rendered every row (hundreds of ms in a production
  // build) where the newest 400 take a few tens. Older ones come in pages
  // from the top.
  const [limit, setLimit] = createSignal(RENDER_PAGE);
  const shown = createMemo(() => {
    const all = visible();
    return all.length > limit() ? all.slice(-limit()) : all;
  });
  const hiddenOlder = () => visible().length - shown().length;
  const showOlder = () => {
    // Keep the rows the user is looking at in place while older ones are
    // prepended above them.
    const before = viewport ? viewport.scrollHeight - viewport.scrollTop : 0;
    setLimit((l) => l + RENDER_PAGE);
    requestAnimationFrame(() => {
      if (viewport) viewport.scrollTop = viewport.scrollHeight - before;
    });
  };

  const functionOptions = () =>
    [...counts().functions]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, count]) => ({ value, count, label: shortFunctionName(value), title: value }));
  const handlerOptions = () =>
    [...counts().handlers]
      .sort(([a], [b]) => (a === NO_HANDLER ? 1 : b === NO_HANDLER ? -1 : a.localeCompare(b)))
      .map(([value, count]) => ({ value, count }));
  const levelOptions = () =>
    LEVELS.map((value) => ({ value, count: counts().levels.get(value) ?? 0 }));

  // Expanded rows by id; ids restart with every connection. The memo matters:
  // `props.generation` is read from the entries buffer, which notifies on every
  // live batch, and `on` re-runs on every notification — without it each batch
  // would collapse whatever the user just opened.
  const [expanded, setExpanded] = createSignal<ReadonlySet<number>>(new Set());
  const generation = createMemo(() => props.generation);
  createEffect(on(generation, () => setExpanded(new Set<number>()), { defer: true }));
  const toggleRow = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Stick to the bottom while the user is there — but not while the pointer
  // is over the list: a live stream would slide rows out from under a click
  // (mousedown and mouseup on different rows never toggle anything).
  let viewport: HTMLDivElement | undefined;
  const [stuck, setStuck] = createSignal(true);
  const [hovering, setHovering] = createSignal(false);
  const onScroll = () => {
    if (!viewport) return;
    setStuck(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 4);
  };
  const followToBottom = () =>
    requestAnimationFrame(() => {
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
  createEffect(
    on(visible, () => {
      if (viewport && stuck() && !hovering()) followToBottom();
    }),
  );
  const onPointerLeave = () => {
    setHovering(false);
    if (stuck()) followToBottom();
  };
  onCleanup(() => {
    viewport = undefined;
  });

  const toggleStatus = (cls: StatusClass) => {
    const cur = filters().statuses;
    setFilters({ statuses: cur.includes(cls) ? cur.filter((c) => c !== cls) : [...cur, cls] });
  };

  return (
    <div class={cx('h-full flex flex-col gap-2 min-h-0', props.class)}>
      <div class="flex flex-wrap items-center gap-1.5">
        <MultiSelect
          label="Function"
          options={functionOptions()}
          selected={asSet(filters().functions)}
          onChange={(next) => setFilters({ functions: next && [...next] })}
        />
        <MultiSelect
          label="Handler"
          options={handlerOptions()}
          selected={asSet(filters().handlers)}
          onChange={(next) => setFilters({ handlers: next && [...next] })}
        />
        <MultiSelect
          label="Level"
          options={levelOptions()}
          selected={asSet(filters().levels)}
          onChange={(next) =>
            setFilters({
              levels: next && (LEVELS.filter((l) => next.has(l)) as ParsedFilters['levels']),
            })
          }
        />
        <ToggleChip
          on={filters().executions}
          onClick={() => setFilters({ executions: !filters().executions })}
          title="One row per function execution"
        >
          ƒ executions
        </ToggleChip>
        <ToggleChip
          on={filters().system}
          onClick={() => setFilters({ system: !filters().system })}
          title="The emulator's own lines: start-up, warnings, load errors"
        >
          system
        </ToggleChip>
        <span class="mx-0.5 h-4 w-px bg-border-subtle" />
        <For each={STATUS_CLASSES}>
          {(cls) => (
            <ToggleChip
              on={filters().statuses.includes(cls)}
              onClick={() => toggleStatus(cls)}
              title={`Only requests answered with ${cls}`}
              tone={cls}
            >
              {cls}
              <Show when={counts().statuses.get(cls)}>
                <span class="text-fg-tertiary tabular-nums">{counts().statuses.get(cls)}</span>
              </Show>
            </ToggleChip>
          )}
        </For>
        <label class="relative flex-1 min-w-[10rem]">
          <IconSearch
            width={12}
            height={12}
            class="absolute left-2 top-1/2 -translate-y-1/2 text-fg-tertiary pointer-events-none"
          />
          <input
            type="search"
            placeholder="search messages and fields"
            value={filters().search}
            onInput={(e) => setFilters({ search: e.currentTarget.value })}
            class={cx(
              'w-full h-7 pl-7 pr-2 rounded-md border border-border-default bg-surface-inset',
              'text-xs text-fg-primary placeholder:text-fg-disabled',
              'focus:outline-none focus:ring-2 focus:ring-accent/50',
            )}
          />
        </label>
        <SourcePill state={props.state} />
      </div>

      <div class="flex items-center justify-between text-[11px] font-mono text-fg-tertiary uppercase tracking-wider">
        <span class="tabular-nums">
          {props.entries().length.toLocaleString()} entries
          <Show when={!isDefault(filters())}>
            {' · '}
            <span class="text-fg-secondary">{visible().length.toLocaleString()} shown</span>
          </Show>
        </span>
        <Show when={!isDefault(filters())}>
          <button
            type="button"
            class="normal-case tracking-normal text-accent hover:text-accent-bright"
            onClick={() => setFilters(DEFAULT_FILTERS)}
          >
            clear filters
          </button>
        </Show>
      </div>

      <Show when={props.state?.state === 'unavailable' && props.state}>
        {(s) => (
          <div class="rounded-md border border-status-starting/40 bg-status-starting/10 px-3 py-2 text-xs text-status-starting">
            {(s() as { detail: string }).detail}
          </div>
        )}
      </Show>

      <div
        ref={viewport}
        onScroll={onScroll}
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={onPointerLeave}
        class={cx(
          'relative flex-1 min-h-0 overflow-y-auto rounded-md',
          'bg-surface-inset border border-border-subtle',
          'font-mono text-[12px] leading-[1.5]',
        )}
      >
        <Show
          when={visible().length > 0}
          fallback={
            <Show
              when={props.entries().length > 0}
              fallback={<NoEntries name={props.name} state={props.state} />}
            >
              <EmptyState
                title="No entries match the filters"
                description={`${props.entries().length.toLocaleString()} entries are hidden.`}
                action={
                  <button
                    type="button"
                    class="text-xs text-accent hover:text-accent-bright"
                    onClick={() => setFilters(DEFAULT_FILTERS)}
                  >
                    clear filters
                  </button>
                }
              />
            </Show>
          }
        >
          <div class="py-1.5">
            <Show when={hiddenOlder() > 0}>
              <div class="px-3 pb-1.5">
                <button
                  type="button"
                  onClick={showOlder}
                  class="text-[11px] text-accent hover:text-accent-bright"
                >
                  show {Math.min(RENDER_PAGE, hiddenOlder()).toLocaleString()} older ·{' '}
                  {hiddenOlder().toLocaleString()} not shown
                </button>
              </div>
            </Show>
            <For each={shown()}>
              {(entry) => (
                <ParsedEntryRow
                  entry={entry}
                  expanded={expanded().has(entry.id)}
                  onToggle={() => toggleRow(entry.id)}
                  ide={props.ide}
                  baseDir={props.baseDir}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}

/**
 * A facet's selection as `MultiSelect` takes it. Written as a function on
 * purpose: Solid compiles `list && new Set(list)` inside a JSX attribute into
 * a memoised boolean test, which hands `false` (not `null`) to the component.
 */
function asSet<T>(list: T[] | null): Set<T> | null {
  return list === null ? null : new Set(list);
}

/** Rows rendered at once, and per "show older" click. */
const RENDER_PAGE = 400;

function NoEntries(props: { name: string; state: ParsedLogState | undefined }) {
  const s = () => props.state;
  return (
    <Show
      when={s()?.state !== 'idle' && s()?.state !== undefined}
      fallback={
        <EmptyState
          title={`${props.name} isn't running`}
          description="Parsed logs appear once it starts and the logging emulator answers."
        />
      }
    >
      <EmptyState
        title={
          s()?.state === 'connected'
            ? 'No logs yet'
            : s()?.state === 'unavailable'
              ? 'No logging emulator to read from'
              : 'Waiting for the Firebase emulators…'
        }
        description={
          s()?.state === 'connected'
            ? 'Function executions and their logs show up here as they happen.'
            : // `unavailable` already shows its hint in the banner above the list.
              s()?.state === 'waiting'
              ? (s() as { detail: string }).detail
              : undefined
        }
      />
    </Show>
  );
}

const PILL: Record<ParsedLogState['state'], { dot: string; text: string; label: string }> = {
  connected: { dot: 'bg-status-ready', text: 'text-fg-secondary', label: 'live' },
  connecting: {
    dot: 'bg-status-starting pulse-dot',
    text: 'text-fg-tertiary',
    label: 'connecting',
  },
  waiting: { dot: 'bg-status-starting pulse-dot', text: 'text-fg-tertiary', label: 'waiting' },
  unavailable: { dot: 'bg-status-failed', text: 'text-status-failed', label: 'unavailable' },
  idle: { dot: 'bg-status-stopped', text: 'text-fg-tertiary', label: 'not running' },
};

/** Where the log source stands, with the detail (hint or URL) on hover. */
export function SourcePill(props: { state: ParsedLogState | undefined }) {
  const look = () => PILL[props.state?.state ?? 'connecting'];
  const title = () => {
    const s = props.state;
    if (!s) return undefined;
    if (s.state === 'connected') return `logging emulator at ${s.url}`;
    return 'detail' in s ? s.detail : undefined;
  };
  return (
    <span
      class={cx('inline-flex items-center gap-1.5 h-7 px-2 text-[11px] font-mono', look().text)}
      title={title()}
    >
      <span class={cx('h-1.5 w-1.5 rounded-full', look().dot)} />
      {look().label}
    </span>
  );
}

const STATUS_TONE: Record<StatusClass, string> = {
  '2xx': 'bg-status-ready/15 border-status-ready/40 text-status-ready',
  '3xx': 'bg-status-finished/15 border-status-finished/40 text-status-finished',
  '4xx': 'bg-status-starting/15 border-status-starting/40 text-status-starting',
  '5xx': 'bg-status-failed/15 border-status-failed/40 text-status-failed',
};

function ToggleChip(props: {
  on: boolean;
  onClick: () => void;
  title?: string;
  tone?: StatusClass;
  children: import('solid-js').JSX.Element;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      title={props.title}
      onClick={() => props.onClick()}
      class={cx(
        'inline-flex items-center gap-1 h-7 px-2 rounded-md border text-xs font-mono',
        'transition-colors duration-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        props.on
          ? props.tone
            ? STATUS_TONE[props.tone]
            : 'bg-surface-2 border-border-strong text-fg-primary'
          : 'bg-transparent border-border-subtle text-fg-tertiary hover:text-fg-secondary',
      )}
    >
      {props.children}
    </button>
  );
}
