import { type JSX, Show } from 'solid-js';
import { cx } from '../lib/cx';
import { IconAlert, IconCheck, IconClose } from '../lib/icons';
import { IconButton } from './IconButton';

type ToastTone = 'info' | 'success' | 'warning' | 'danger';

const TONE: Record<
  ToastTone,
  { container: string; iconColor: string; icon: () => JSX.Element }
> = {
  info: {
    container: 'border-status-finished/40 bg-status-finished/10',
    iconColor: 'text-status-finished',
    icon: () => <IconAlert width={16} height={16} />,
  },
  success: {
    container: 'border-status-ready/40 bg-status-ready/10',
    iconColor: 'text-status-ready',
    icon: () => <IconCheck width={16} height={16} />,
  },
  warning: {
    container: 'border-status-starting/40 bg-status-starting/10',
    iconColor: 'text-status-starting',
    icon: () => <IconAlert width={16} height={16} />,
  },
  danger: {
    container: 'border-status-failed/40 bg-status-failed/10',
    iconColor: 'text-status-failed',
    icon: () => <IconAlert width={16} height={16} />,
  },
};

export function Toast(props: {
  tone?: ToastTone;
  title: JSX.Element;
  description?: JSX.Element;
  onDismiss?: () => void;
  class?: string;
}) {
  const tone = () => TONE[props.tone ?? 'info'];
  return (
    <div
      role="status"
      class={cx(
        'flex items-start gap-3 px-3 py-2.5',
        'rounded-md border backdrop-blur-md shadow-lift',
        tone().container,
        props.class,
      )}
    >
      <span class={cx('flex-shrink-0 mt-0.5', tone().iconColor)}>{tone().icon()}</span>
      <div class="flex-1 min-w-0">
        <div class="text-[13px] font-medium text-fg-primary">{props.title}</div>
        <Show when={props.description}>
          <div class="text-xs text-fg-tertiary mt-0.5">{props.description}</div>
        </Show>
      </div>
      <Show when={props.onDismiss}>
        <IconButton size="sm" variant="ghost" label="dismiss" onClick={props.onDismiss}>
          <IconClose width={14} height={14} />
        </IconButton>
      </Show>
    </div>
  );
}
