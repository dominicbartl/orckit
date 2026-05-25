import { type JSX, createMemo } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { BrandLogo } from './components/Brand';
import { cx } from './lib/cx';
import { IconGraph, IconLogs } from './lib/icons';
import {
  OrckitProvider,
  createOrckitStream,
  useOrckit,
  type ConnectionStatus,
} from './lib/stream';
import { ToastProvider } from './lib/toasts';

export default function App(props: { children?: JSX.Element }) {
  // Single shared stream for the whole app. The sink page ignores it but the
  // dashboard reads from it; mounting once here means a single SSE connection
  // regardless of route navigation.
  const stream = createOrckitStream();
  return (
    <OrckitProvider stream={stream}>
      <ToastProvider>
        <div class="flex h-full flex-col">
          <TopBar />
          <main class="flex-1 min-h-0 overflow-hidden">{props.children}</main>
        </div>
      </ToastProvider>
    </OrckitProvider>
  );
}

function TopBar() {
  return (
    <header
      class={cx(
        'flex items-center justify-between h-12 px-4',
        'border-b border-border-subtle bg-surface-0/80 backdrop-blur',
      )}
    >
      <div class="flex items-center gap-6">
        <BrandLogo />
        <nav class="flex items-center gap-1">
          <NavLink href="/" label="Dashboard" icon={<IconLogs width={14} height={14} />} />
          <NavLink href="/sink" label="Kitchen sink" icon={<IconGraph width={14} height={14} />} />
        </nav>
      </div>
      <ConnectionIndicator />
    </header>
  );
}

function ConnectionIndicator() {
  const orckit = useOrckit();
  const meta = createMemo(() => STATUS_META[orckit.status()]);
  return (
    <div
      class="flex items-center gap-2 text-[11px] font-mono text-fg-tertiary"
      title={meta().tooltip}
    >
      <span class="hidden sm:inline">orckit web-ui</span>
      <span
        class={cx(
          'h-1.5 w-1.5 rounded-full',
          meta().dotClass,
          meta().pulse && 'pulse-dot',
        )}
        aria-hidden="true"
      />
      <span class={meta().labelClass}>{meta().label}</span>
    </div>
  );
}

const STATUS_META: Record<
  ConnectionStatus,
  { label: string; tooltip: string; dotClass: string; labelClass: string; pulse: boolean }
> = {
  connecting: {
    label: 'connecting',
    tooltip: 'Opening event stream...',
    dotClass: 'bg-status-starting',
    labelClass: 'text-status-starting',
    pulse: true,
  },
  connected: {
    label: 'connected',
    tooltip: 'Subscribed to /events',
    dotClass: 'bg-status-ready',
    labelClass: 'text-fg-tertiary',
    pulse: false,
  },
  reconnecting: {
    label: 'reconnecting',
    tooltip: 'Lost connection, retrying...',
    dotClass: 'bg-status-stopping',
    labelClass: 'text-status-stopping',
    pulse: true,
  },
  disconnected: {
    label: 'offline',
    tooltip: 'Could not reach orckit',
    dotClass: 'bg-status-failed',
    labelClass: 'text-status-failed',
    pulse: false,
  },
};

function NavLink(props: { href: string; label: string; icon: JSX.Element }) {
  const location = useLocation();
  const isActive = () =>
    props.href === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(props.href);
  return (
    <A
      href={props.href}
      end={props.href === '/'}
      class={cx(
        'inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-[12px] font-medium',
        'transition-colors duration-100',
        isActive()
          ? 'bg-surface-2 text-fg-primary'
          : 'text-fg-tertiary hover:text-fg-secondary hover:bg-surface-1',
      )}
    >
      {props.icon}
      {props.label}
    </A>
  );
}
