import { type JSX, splitProps } from 'solid-js';
import { cx } from '../lib/cx';

interface IconButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md';
  variant?: 'ghost' | 'solid' | 'danger';
  label: string;
}

const sizes = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
} as const;

const variants = {
  ghost:
    'bg-transparent text-fg-secondary hover:bg-surface-2 hover:text-fg-primary active:bg-surface-3',
  solid:
    'bg-surface-2 text-fg-primary border border-border-default ' +
    'hover:bg-surface-3 hover:border-border-strong active:bg-surface-2',
  danger:
    'bg-transparent text-status-failed hover:bg-status-failed/15 active:bg-status-failed/25',
} as const;

export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, [
    'size',
    'variant',
    'label',
    'children',
    'class',
    'disabled',
  ]);
  return (
    <button
      type="button"
      aria-label={local.label}
      title={local.label}
      class={cx(
        'inline-flex items-center justify-center rounded-md transition-colors duration-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        sizes[local.size ?? 'md'],
        variants[local.variant ?? 'ghost'],
        local.class,
      )}
      disabled={local.disabled}
      {...rest}
    >
      {local.children}
    </button>
  );
}
