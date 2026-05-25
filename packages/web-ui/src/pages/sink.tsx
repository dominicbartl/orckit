import { For, createSignal, type JSX } from 'solid-js';
import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { Badge, StateBadge } from '../components/Badge';
import { StatusDot } from '../components/StatusDot';
import { Card, CardHeader, SectionDivider } from '../components/Card';
import { TabBar } from '../components/TabBar';
import { Toast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';
import { LogView } from '../components/LogView';
import { ProcessRow } from '../components/ProcessRow';
import { Sparkline } from '../components/Sparkline';
import { BrandMark, BrandLogo } from '../components/Brand';
import {
  IconRestart,
  IconStop,
  IconCheck,
  IconCopy,
  IconLogs,
  IconSearch,
  IconSettings,
} from '../lib/icons';
import type { OutputLine, ProcessSnapshot, ProcessState } from '../lib/types';

const STATES: ProcessState[] = [
  'pending',
  'starting',
  'ready',
  'running',
  'finished',
  'stopping',
  'stopped',
  'failed',
];

const SAMPLE_LINES: OutputLine[] = [
  { text: '> next dev', stream: 'stdout', timestamp: Date.now() - 8000 },
  { text: '   ▲ Next.js 15.0.3', stream: 'stdout', timestamp: Date.now() - 7800 },
  { text: '   - Local:        http://localhost:3000', stream: 'stdout', timestamp: Date.now() - 7600 },
  {
    text: '   - Network:      http://192.168.1.7:3000',
    stream: 'stdout',
    timestamp: Date.now() - 7500,
  },
  { text: ' ✓ Ready in 1.2s', stream: 'stdout', timestamp: Date.now() - 6800, highlight: 'green' },
  {
    text: 'warn  - Slow image route: /api/og-image (842ms)',
    stream: 'stdout',
    timestamp: Date.now() - 4000,
    highlight: 'yellow',
  },
  {
    text: 'POST /api/billing/checkout 200 in 47ms',
    stream: 'stdout',
    timestamp: Date.now() - 2200,
  },
  {
    text: 'Error: timeout connecting to redis://cache:6379',
    stream: 'stderr',
    timestamp: Date.now() - 1500,
  },
  {
    text: '    at TcpConnect.tryHost (lib/redis/connect.ts:42:18)',
    stream: 'stderr',
    timestamp: Date.now() - 1499,
  },
  {
    text: '    at processTicksAndRejections (node:internal/process/task_queues:96:5)',
    stream: 'stderr',
    timestamp: Date.now() - 1498,
  },
  {
    text: 'POST /api/billing/checkout 500 in 5012ms',
    stream: 'stdout',
    timestamp: Date.now() - 1400,
    highlight: 'red',
  },
];

const SAMPLE_PROCESSES: ProcessSnapshot[] = [
  {
    name: 'postgres',
    state: 'ready',
    type: 'bash',
    command: 'docker compose up postgres',
    category: 'infra',
    depends_on: [],
    pid: 12041,
    startedAt: Date.now() - 60_000,
    retries: 0,
    optional: false,
  },
  {
    name: 'redis',
    state: 'failed',
    type: 'bash',
    command: 'docker compose up redis',
    category: 'infra',
    depends_on: [],
    pid: null,
    startedAt: null,
    retries: 2,
    optional: false,
    lastError: 'exited (code 1) — port 6379 in use',
  },
  {
    name: 'migrations',
    state: 'finished',
    type: 'bash',
    command: 'pnpm db migrate',
    category: 'backend',
    depends_on: ['postgres'],
    pid: null,
    startedAt: Date.now() - 50_000,
    retries: 0,
    optional: false,
  },
  {
    name: 'api',
    state: 'running',
    type: 'bash',
    command: 'pnpm dev --filter api',
    category: 'backend',
    depends_on: ['postgres', 'migrations'],
    pid: 12101,
    startedAt: Date.now() - 30_000,
    retries: 0,
    optional: false,
  },
  {
    name: 'web',
    state: 'starting',
    type: 'webpack',
    command: 'pnpm dev --filter web',
    category: 'frontend',
    depends_on: ['api'],
    pid: 12180,
    startedAt: Date.now() - 5000,
    retries: 0,
    optional: false,
  },
  {
    name: 'worker',
    state: 'pending',
    type: 'bash',
    command: 'pnpm worker',
    category: 'backend',
    depends_on: ['redis', 'api'],
    pid: null,
    startedAt: null,
    retries: 0,
    optional: false,
  },
];

export default function Sink() {
  const [tab, setTab] = createSignal('logs');
  const [selectedProcess, setSelectedProcess] = createSignal('api');
  const [showToast, setShowToast] = createSignal(true);
  const [loading, setLoading] = createSignal(false);

  return (
    <div class="h-full overflow-y-auto">
      <div class="mx-auto max-w-6xl px-6 py-8">
        <PageHeader />

        <Section
          title="Tokens"
          subtitle="Color tokens drive every component. Status colors mirror the CLI reporter so terminal users and browser users see the same palette."
        >
          <SwatchGrid />
        </Section>

        <Section title="Status" subtitle="Every ProcessState the orchestrator can be in, mapped to dot + badge.">
          <Card>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
              <For each={STATES}>
                {(state) => (
                  <div class="flex items-center gap-2">
                    <StatusDot state={state} />
                    <StateBadge state={state} />
                  </div>
                )}
              </For>
            </div>
          </Card>
        </Section>

        <Section title="Buttons" subtitle="Variants, sizes, and the loading state used during restart actions.">
          <Card>
            <div class="space-y-5">
              <Row label="Variants">
                <Button variant="primary">Restart</Button>
                <Button variant="secondary">Cancel</Button>
                <Button variant="danger" leadingIcon={<IconStop width={12} height={12} />}>
                  Stop all
                </Button>
                <Button variant="ghost">Tail logs</Button>
              </Row>
              <Row label="Sizes">
                <Button size="sm" variant="primary">
                  sm
                </Button>
                <Button size="md" variant="primary">
                  md
                </Button>
              </Row>
              <Row label="With icons">
                <Button
                  variant="primary"
                  leadingIcon={<IconRestart width={13} height={13} />}
                  onClick={() => {
                    setLoading(true);
                    setTimeout(() => setLoading(false), 1500);
                  }}
                  loading={loading()}
                >
                  Restart api
                </Button>
                <Button variant="secondary" trailingIcon={<IconCopy width={13} height={13} />}>
                  Copy url
                </Button>
              </Row>
              <Row label="Disabled">
                <Button variant="primary" disabled>
                  Disabled
                </Button>
                <Button variant="secondary" disabled>
                  Disabled
                </Button>
              </Row>
              <Row label="Icon buttons">
                <IconButton label="restart">
                  <IconRestart width={14} height={14} />
                </IconButton>
                <IconButton label="stop" variant="danger">
                  <IconStop width={14} height={14} />
                </IconButton>
                <IconButton label="settings" variant="solid">
                  <IconSettings width={14} height={14} />
                </IconButton>
                <IconButton label="search" size="sm">
                  <IconSearch width={12} height={12} />
                </IconButton>
              </Row>
            </div>
          </Card>
        </Section>

        <Section title="Badges" subtitle="Used for tags, counts, and meta info on cards.">
          <Card>
            <div class="flex flex-wrap items-center gap-2">
              <Badge>neutral</Badge>
              <Badge tone="accent">accent</Badge>
              <Badge tone="success">
                <IconCheck width={10} height={10} />
                success
              </Badge>
              <Badge tone="warning">warning</Badge>
              <Badge tone="danger">danger</Badge>
              <Badge tone="info">info</Badge>
              <Badge tone="neutral">pid 12101</Badge>
              <Badge tone="neutral">retry ×2</Badge>
            </div>
          </Card>
        </Section>

        <Section title="Tabs" subtitle="Compact, low-noise tab strip for inline switching.">
          <Card>
            <TabBar
              active={tab()}
              onChange={setTab}
              tabs={[
                {
                  id: 'logs',
                  label: (
                    <>
                      <IconLogs width={12} height={12} />
                      Logs
                    </>
                  ),
                },
                { id: 'env', label: 'Env' },
                {
                  id: 'errors',
                  label: 'Errors',
                  badge: <Badge tone="danger">3</Badge>,
                },
                { id: 'deps', label: 'Deps' },
              ]}
            />
          </Card>
        </Section>

        <Section title="Cards" subtitle="Surface containers — process cards reuse this with header + actions.">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader
                title="api"
                subtitle="pnpm dev --filter api · pid 12101"
                trailing={
                  <>
                    <StateBadge state="running" />
                    <IconButton label="restart">
                      <IconRestart width={14} height={14} />
                    </IconButton>
                  </>
                }
              />
              <SectionDivider label="last 1 min" />
              <Sparkline values={[2, 4, 3, 6, 7, 5, 9, 12, 8, 11, 10, 14]} width={280} height={32} />
            </Card>
            <Card>
              <CardHeader
                title="redis"
                subtitle="docker compose up redis"
                trailing={<StateBadge state="failed" />}
              />
              <p class="text-xs text-status-failed font-mono">
                exited (code 1) — port 6379 in use
              </p>
            </Card>
          </div>
        </Section>

        <Section title="Process row" subtitle="The atomic unit of the dashboard's left panel.">
          <Card padded={false}>
            <For each={SAMPLE_PROCESSES}>
              {(p) => (
                <ProcessRow
                  process={p}
                  selected={p.name === selectedProcess()}
                  onSelect={() => setSelectedProcess(p.name)}
                  onRestart={() => undefined}
                  onStop={() => undefined}
                />
              )}
            </For>
          </Card>
        </Section>

        <Section title="Log view" subtitle="Auto-sticks to the bottom; scroll up to read history.">
          <div class="h-64">
            <LogView lines={() => SAMPLE_LINES} />
          </div>
        </Section>

        <Section title="Empty state" subtitle="When there's no data, no errors, or nothing selected.">
          <Card>
            <EmptyState
              icon={<IconLogs width={28} height={28} />}
              title="No logs yet"
              description="Output will appear here once the process starts. Tail and filter to focus on what matters."
              action={
                <Button variant="primary" leadingIcon={<IconRestart width={12} height={12} />}>
                  Start process
                </Button>
              }
            />
          </Card>
        </Section>

        <Section title="Toasts" subtitle="Transient feedback for restart, stop, and connection events.">
          <div class="space-y-2 max-w-md">
            <Toast tone="success" title="api restarted" description="Healthy after 1.2s." />
            <Toast
              tone="warning"
              title="redis is failing"
              description="2 retries used. mark manual_retry: true to pause auto-retry."
            />
            <Toast
              tone="danger"
              title="boot failed"
              description="strict failures: redis. orckit stays alive — fix and retry."
              onDismiss={() => undefined}
            />
            {showToast() && (
              <Toast
                tone="info"
                title="connection re-established"
                description="Resumed event stream."
                onDismiss={() => setShowToast(false)}
              />
            )}
          </div>
        </Section>

        <Section title="Brand" subtitle="The wave motif — four stacked bars echoing dependency waves.">
          <Card>
            <div class="flex items-center gap-8">
              <BrandLogo />
              <BrandMark size={32} />
              <BrandMark size={48} />
              <div class="flex-1 h-6 wave-rule rounded-sm" />
            </div>
          </Card>
        </Section>
      </div>
    </div>
  );
}

function PageHeader() {
  return (
    <div class="mb-10">
      <div class="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-fg-tertiary">
        <span class="h-px w-8 bg-accent" />
        Design system
      </div>
      <h1 class="mt-2 text-2xl font-medium text-fg-primary tracking-tight">Kitchen sink</h1>
      <p class="mt-1 text-sm text-fg-tertiary max-w-xl">
        Every component the orckit dashboard uses, in every state. No live data — these are
        static fixtures so you can verify color, spacing, and behavior in isolation.
      </p>
    </div>
  );
}

function Section(props: { title: string; subtitle?: string; children: JSX.Element }) {
  return (
    <section class="mb-12">
      <div class="mb-3">
        <h2 class="text-[13px] font-medium text-fg-primary tracking-tight uppercase font-mono">
          {props.title}
        </h2>
        {props.subtitle && (
          <p class="text-xs text-fg-tertiary mt-0.5 max-w-2xl">{props.subtitle}</p>
        )}
      </div>
      {props.children}
    </section>
  );
}

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex items-center gap-4">
      <span class="w-20 text-[11px] uppercase tracking-wider font-mono text-fg-tertiary">
        {props.label}
      </span>
      <div class="flex flex-wrap items-center gap-2">{props.children}</div>
    </div>
  );
}

function SwatchGrid() {
  const tokens = [
    { name: 'surface-0', class: 'bg-surface-0' },
    { name: 'surface-1', class: 'bg-surface-1' },
    { name: 'surface-2', class: 'bg-surface-2' },
    { name: 'surface-3', class: 'bg-surface-3' },
    { name: 'accent', class: 'bg-accent' },
    { name: 'accent-bright', class: 'bg-accent-bright' },
    { name: 'status-ready', class: 'bg-status-ready' },
    { name: 'status-starting', class: 'bg-status-starting' },
    { name: 'status-failed', class: 'bg-status-failed' },
    { name: 'status-finished', class: 'bg-status-finished' },
    { name: 'status-stopped', class: 'bg-status-stopped' },
    { name: 'fg-primary', class: 'bg-fg-primary' },
  ];
  return (
    <Card>
      <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <For each={tokens}>
          {(t) => (
            <div class="flex flex-col gap-1.5">
              <div
                class={`h-10 rounded-md border border-border-subtle ${t.class}`}
                aria-hidden="true"
              />
              <span class="text-[10px] font-mono text-fg-tertiary">{t.name}</span>
            </div>
          )}
        </For>
      </div>
    </Card>
  );
}
