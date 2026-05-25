import { For, Show, createSignal } from 'solid-js';
import type { ProcessSnapshot, ProcessState } from '../lib/types';
import { ProcessRow } from './ProcessRow';
import { IconChevron } from '../lib/icons';
import { cx } from '../lib/cx';
import { StatusDot } from './StatusDot';

interface ProcessGroupProps {
  name: string;
  processes: ProcessSnapshot[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onRestart: (name: string) => void;
  onStop: (name: string) => void;
  defaultOpen?: boolean;
}

/**
 * Collapsible group of processes sharing a `category`. The header reads
 * "category · N processes" with a compact health summary — N ready, N
 * failed — so the user can scan health without expanding.
 */
export function ProcessGroup(props: ProcessGroupProps) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? true);

  const summary = () => summarize(props.processes);

  return (
    <section class="border-b border-border-subtle last:border-0">
      <button
        type="button"
        onClick={() => setOpen(!open())}
        class={cx(
          'group w-full flex items-center gap-2 px-3 py-2',
          'text-left transition-colors duration-75',
          'hover:bg-surface-1/60 focus-visible:outline-none focus-visible:bg-surface-1',
        )}
      >
        <IconChevron
          width={12}
          height={12}
          class={cx(
            'text-fg-tertiary transition-transform duration-150',
            open() ? 'rotate-90' : '',
          )}
        />
        <span class="text-[11px] uppercase tracking-wider font-mono text-fg-secondary flex-1">
          {props.name}
        </span>
        <span class="text-[10px] font-mono text-fg-tertiary">{props.processes.length}</span>
        <GroupHealth summary={summary()} />
      </button>
      <Show when={open()}>
        <div class="bg-surface-0/50">
          <For each={props.processes}>
            {(p) => (
              <ProcessRow
                process={p}
                selected={p.name === props.selectedName}
                onSelect={() => props.onSelect(p.name)}
                onRestart={() => props.onRestart(p.name)}
                onStop={() => props.onStop(p.name)}
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

function GroupHealth(props: { summary: ReturnType<typeof summarize> }) {
  const dots: { state: ProcessState; count: number }[] = [];
  if (props.summary.failed > 0) dots.push({ state: 'failed', count: props.summary.failed });
  if (props.summary.starting > 0) dots.push({ state: 'starting', count: props.summary.starting });
  if (props.summary.ready > 0) dots.push({ state: 'ready', count: props.summary.ready });
  return (
    <span class="flex items-center gap-1.5">
      <For each={dots}>
        {(d) => (
          <span class="flex items-center gap-1">
            <StatusDot state={d.state} size="sm" />
            <span class="text-[10px] font-mono text-fg-tertiary tabular-nums">{d.count}</span>
          </span>
        )}
      </For>
    </span>
  );
}

function summarize(processes: ProcessSnapshot[]) {
  let ready = 0;
  let starting = 0;
  let failed = 0;
  let pending = 0;
  for (const p of processes) {
    if (p.state === 'ready' || p.state === 'running' || p.state === 'finished') ready++;
    else if (p.state === 'starting' || p.state === 'stopping') starting++;
    else if (p.state === 'failed') failed++;
    else if (p.state === 'pending') pending++;
  }
  return { ready, starting, failed, pending };
}

/**
 * Group processes by category, preserving insertion order. Returns a list of
 * `[categoryName, processes[]]` pairs.
 */
export function groupByCategory(
  processes: ProcessSnapshot[],
): Array<[string, ProcessSnapshot[]]> {
  const order: string[] = [];
  const buckets = new Map<string, ProcessSnapshot[]>();
  for (const p of processes) {
    const cat = p.category || 'default';
    if (!buckets.has(cat)) {
      buckets.set(cat, []);
      order.push(cat);
    }
    buckets.get(cat)!.push(p);
  }
  return order.map((cat) => [cat, buckets.get(cat)!]);
}

