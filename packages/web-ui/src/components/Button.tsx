import { type JSX, splitProps, Show } from 'solid-js';
import { cx } from '../lib/cx';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leadingIcon?: JSX.Element;
  trailingIcon?: JSX.Element;
}

const base =
  'inline-flex items-center justify-center gap-1.5 select-none ' +
  'font-medium tracking-tight whitespace-nowrap ' +
  'rounded-md border transition-colors duration-100 ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-8 px-3 text-[13px]',
};

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-fg-on-accent border-accent ' +
    'hover:bg-accent-bright hover:border-accent-bright active:bg-accent-dim',
  secondary:
    'bg-surface-2 text-fg-primary border-border-default ' +
    'hover:bg-surface-3 hover:border-border-strong active:bg-surface-2',
  danger:
    'bg-status-failed/15 text-status-failed border-status-failed/40 ' +
    'hover:bg-status-failed/25 hover:border-status-failed/60 active:bg-status-failed/35',
  ghost:
    'bg-transparent text-fg-secondary border-transparent ' +
    'hover:bg-surface-2 hover:text-fg-primary active:bg-surface-3',
};

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, [
    'variant',
    'size',
    'loading',
    'leadingIcon',
    'trailingIcon',
    'class',
    'children',
    'disabled',
  ]);
  const variant = () => local.variant ?? 'secondary';
  const size = () => local.size ?? 'md';
  return (
    <button
      type="button"
      class={cx(base, sizes[size()], variants[variant()], local.class)}
      disabled={local.disabled || local.loading}
      {...rest}
    >
      <Show
        when={local.loading}
        fallback={
          <>
            {local.leadingIcon}
            {local.children}
            {local.trailingIcon}
          </>
        }
      >
        <Spinner />
        {local.children}
      </Show>
    </button>
  );
}

function Spinner() {
  return (
    <svg
      class="spin"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M12 3a9 9 0 0 1 9 9" />
    </svg>
  );
}
