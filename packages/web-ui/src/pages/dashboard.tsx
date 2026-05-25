import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type Accessor,
} from 'solid-js';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { Badge, StateBadge } from '../components/Badge';
import { Card } from '../components/Card';
import { TabBar } from '../components/TabBar';
import { Toast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';
import { LogView } from '../components/LogView';
import {
  ProcessGroup,
  groupByCategory,
} from '../components/ProcessGroup';
import { BrandMark } from '../components/Brand';
import { IconRestart, IconStop, IconLogs, IconAlert, IconCopy } from '../lib/icons';
import { useOrckit } from '../lib/stream';
import { useToasts } from '../lib/toasts';
import { restartProcess, stopProcess } from '../lib/api';
import type { OutputLine, ProcessSnapshot } from '../lib/types';
import { cx } from '../lib/cx';

export default function DashboardPage() {
  return (
    <>
      <DashboardInner />
      <ToastStack />
    </>
  );
}

function DashboardInner() {
  const orckit = useOrckit();
  const actions = useProcessActions();
  const [selected, setSelected] = createSignal<string | null>(null);

  // Auto-select the first process once a snapshot arrives so the right pane
  // isn't empty on first paint.
  createEffect(() => {
    const list = orckit.processes();
    if (selected() == null && list.length > 0) {
      setSelected(list[0]!.name);
    }
  });

  // Hydrate the output buffer for the selected process so the log view shows
  // history instead of just events that arrive *after* selection.
  createEffect(() => {
    const name = selected();
    if (!name) return;
    void orckit.hydrateOutput(name).catch(() => {
      // best-effort; SSE will keep populating going forward
    });
  });

  const selectedProcess = createMemo(() => {
    const name = selected();
    return name ? orckit.process(name) : undefined;
  });

  return (
    <div class="h-full flex">
      <aside class="w-80 flex-shrink-0 border-r border-border-subtle bg-surface-0 overflow-y-auto">
        <ProjectHeader />
        <Show
          when={orckit.processes().length > 0}
          fallback={
            <EmptyState
              icon={<BrandMark size={24} />}
              title="Waiting for processes"
              description="Connecting to orckit..."
            />
          }
        >
          <For each={groupByCategory(orckit.processes())}>
            {([categoryName, group]) => (
              <ProcessGroup
                name={categoryName}
                processes={group}
                selectedName={selected()}
                onSelect={(name) => setSelected(name)}
                onRestart={(name) => void actions.restart(name)}
                onStop={(name) => void actions.stop(name)}
              />
            )}
          </For>
        </Show>
      </aside>

      <main class="flex-1 min-w-0 flex flex-col">
        <Show
          when={selectedProcess()}
          fallback={
            <div class="flex-1 flex items-center justify-center">
              <EmptyState
                icon={<IconLogs width={24} height={24} />}
                title="No process selected"
                description="Pick a process from the left to see its logs and controls."
              />
            </div>
          }
        >
          {(p) => <ProcessDetail process={p} logs={orckit.logsFor(p().name)} />}
        </Show>
      </main>
    </div>
  );
}

function ProjectHeader() {
  const orckit = useOrckit();
  const summary = () => {
    const list = orckit.processes();
    let ready = 0;
    let failed = 0;
    for (const p of list) {
      if (p.state === 'ready' || p.state === 'running' || p.state === 'finished') ready++;
      else if (p.state === 'failed') failed++;
    }
    return { ready, failed, total: list.length };
  };
  return (
    <div class="px-4 py-3 border-b border-border-subtle">
      <div class="text-[10px] uppercase tracking-wider font-mono text-fg-tertiary">
        project
      </div>
      <div class="mt-0.5 flex items-center justify-between gap-2">
        <span class="text-sm font-medium text-fg-primary truncate" title={orckit.project()}>
          {orckit.project() || '—'}
        </span>
        <Show when={summary().total > 0}>
          <div class="flex items-center gap-2 text-[11px] font-mono text-fg-tertiary tabular-nums">
            <span>
              <span class="text-status-ready">{summary().ready}</span>
              <span class="text-fg-disabled">/{summary().total}</span>
            </span>
            <Show when={summary().failed > 0}>
              <span class="text-status-failed">{summary().failed} failed</span>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}

function ProcessDetail(props: {
  process: Accessor<ProcessSnapshot>;
  logs: Accessor<OutputLine[]>;
}) {
  const [tab, setTab] = createSignal<'logs' | 'errors' | 'details'>('logs');
  const errorCount = () => (props.process().lastError ? 1 : 0);

  // Reset to "logs" when switching processes — avoids landing on "errors"
  // when the new process has none.
  createEffect(() => {
    void props.process().name;
    setTab('logs');
  });

  return (
    <div class="flex flex-col h-full min-h-0">
      <DetailHeader process={props.process} />
      <div class="px-5 pt-3 pb-2 border-b border-border-subtle">
        <TabBar
          active={tab()}
          onChange={(id) => setTab(id as 'logs' | 'errors' | 'details')}
          tabs={[
            { id: 'logs', label: <>Logs</> },
            {
              id: 'errors',
              label: <>Errors</>,
              badge:
                errorCount() > 0 ? <Badge tone="danger">{errorCount()}</Badge> : undefined,
            },
            { id: 'details', label: <>Details</> },
          ]}
        />
      </div>
      <div class="flex-1 min-h-0 overflow-hidden p-5">
        <Show when={tab() === 'logs'}>
          <LogPanel logs={props.logs} processName={props.process().name} />
        </Show>
        <Show when={tab() === 'errors'}>
          <ErrorsPanel process={props.process} />
        </Show>
        <Show when={tab() === 'details'}>
          <DetailsPanel process={props.process} />
        </Show>
      </div>
    </div>
  );
}

function DetailHeader(props: { process: Accessor<ProcessSnapshot> }) {
  const p = () => props.process();
  const actions = useProcessActions();
  const canStop = () => ['starting', 'ready', 'running'].includes(p().state);
  const [restarting, setRestarting] = createSignal(false);
  const [stopping, setStopping] = createSignal(false);

  return (
    <header class="px-5 py-4 border-b border-border-subtle">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h1 class="font-mono text-lg font-medium text-fg-primary truncate">{p().name}</h1>
            <StateBadge state={p().state} />
            <Show when={p().category && p().category !== 'default'}>
              <Badge tone="accent">{p().category}</Badge>
            </Show>
            <Show when={p().retries > 0}>
              <Badge tone="warning">retry ×{p().retries}</Badge>
            </Show>
          </div>
          <div class="mt-1 text-[12px] text-fg-tertiary font-mono truncate" title={p().command}>
            {p().command}
          </div>
          <div class="mt-1 flex items-center gap-3 text-[11px] text-fg-tertiary font-mono">
            <Show when={p().pid != null}>
              <span>pid {p().pid}</span>
            </Show>
            <Show when={p().startedAt}>
              <span>up {formatDuration(Date.now() - (p().startedAt ?? Date.now()))}</span>
            </Show>
            <span>type {p().type}</span>
            <Show when={p().depends_on.length > 0}>
              <span>deps {p().depends_on.join(', ')}</span>
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <Button
            size="md"
            variant="secondary"
            leadingIcon={<IconRestart width={13} height={13} />}
            loading={restarting()}
            onClick={async () => {
              setRestarting(true);
              try {
                await actions.restart(p().name);
              } finally {
                setRestarting(false);
              }
            }}
          >
            Restart
          </Button>
          <Button
            size="md"
            variant="danger"
            leadingIcon={<IconStop width={13} height={13} />}
            disabled={!canStop()}
            loading={stopping()}
            onClick={async () => {
              setStopping(true);
              try {
                await actions.stop(p().name);
              } finally {
                setStopping(false);
              }
            }}
          >
            Stop
          </Button>
        </div>
      </div>
    </header>
  );
}

function LogPanel(props: { logs: Accessor<OutputLine[]>; processName: string }) {
  return (
    <div class="h-full flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <div class="text-[11px] font-mono text-fg-tertiary uppercase tracking-wider">
          last {props.logs().length} lines · live
        </div>
        <IconButton
          label="copy logs"
          size="sm"
          onClick={() => {
            const text = props
              .logs()
              .map((l) => l.text)
              .join('\n');
            void navigator.clipboard.writeText(text);
          }}
        >
          <IconCopy width={12} height={12} />
        </IconButton>
      </div>
      <div class="flex-1 min-h-0">
        <LogView lines={props.logs} emptyHint={`no output from ${props.processName} yet`} />
      </div>
    </div>
  );
}

function ErrorsPanel(props: { process: Accessor<ProcessSnapshot> }) {
  const p = () => props.process();
  return (
    <Show
      when={p().lastError}
      fallback={
        <EmptyState
          icon={<IconAlert width={28} height={28} />}
          title="No errors"
          description={`${p().name} hasn't reported any failures.`}
        />
      }
    >
      <Card>
        <div class="flex items-start gap-3">
          <span class="text-status-failed flex-shrink-0 mt-0.5">
            <IconAlert width={18} height={18} />
          </span>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-fg-primary">Last error</div>
            <pre class="mt-1 text-[12px] font-mono text-status-failed whitespace-pre-wrap break-all">
              {p().lastError}
            </pre>
            <Show when={p().retries > 0}>
              <div class="mt-3 text-[11px] font-mono text-fg-tertiary">
                {p().retries} retry attempt{p().retries === 1 ? '' : 's'} consumed
              </div>
            </Show>
          </div>
        </div>
      </Card>
    </Show>
  );
}

function DetailsPanel(props: { process: Accessor<ProcessSnapshot> }) {
  const p = () => props.process();
  return (
    <Card>
      <dl class="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-[12px]">
        <Field label="State" value={<StateBadge state={p().state} />} />
        <Field label="Category" value={p().category || 'default'} mono />
        <Field label="Type" value={p().type} mono />
        <Field label="Command" value={p().command} mono />
        <Field label="PID" value={p().pid != null ? String(p().pid) : '—'} mono />
        <Field
          label="Started"
          value={p().startedAt ? new Date(p().startedAt!).toLocaleTimeString() : '—'}
          mono
        />
        <Field
          label="Dependencies"
          value={p().depends_on.length > 0 ? p().depends_on.join(', ') : '—'}
          mono
        />
        <Field label="Retries" value={String(p().retries)} mono />
      </dl>
    </Card>
  );
}

function Field(props: { label: string; value: import('solid-js').JSX.Element; mono?: boolean }) {
  return (
    <>
      <dt class="text-fg-tertiary font-mono text-[11px] uppercase tracking-wider self-center">
        {props.label}
      </dt>
      <dd
        class={cx(
          'text-fg-primary break-all',
          props.mono ? 'font-mono text-[12px]' : 'text-[12px]',
        )}
      >
        {props.value}
      </dd>
    </>
  );
}

/**
 * Hook bundling restart + stop with toast feedback. Lives in the component
 * tree so it can read the closest <ToastProvider>.
 */
function useProcessActions() {
  const toasts = useToasts();
  return {
    async restart(name: string) {
      try {
        await restartProcess(name);
        toasts.push({ tone: 'success', title: `Restarted ${name}` });
      } catch (err) {
        toasts.push({
          tone: 'danger',
          title: `Restart failed: ${name}`,
          description: (err as Error).message,
          ttl: 6000,
        });
      }
    },
    async stop(name: string) {
      try {
        await stopProcess(name);
        toasts.push({ tone: 'info', title: `Stopped ${name}` });
      } catch (err) {
        toasts.push({
          tone: 'danger',
          title: `Stop failed: ${name}`,
          description: (err as Error).message,
          ttl: 6000,
        });
      }
    },
  };
}

function ToastStack() {
  const toasts = useToasts();
  return (
    <div class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[min(24rem,calc(100vw-2rem))]">
      <For each={toasts.toasts()}>
        {(t) => (
          <div class="pointer-events-auto">
            <Toast
              tone={t.tone}
              title={t.title}
              description={t.description}
              onDismiss={() => toasts.dismiss(t.id)}
            />
          </div>
        )}
      </For>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}
