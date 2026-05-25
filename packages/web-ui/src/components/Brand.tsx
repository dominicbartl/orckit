import { cx } from '../lib/cx';

/**
 * The orckit brand mark: four stacked bars of varying length, each one a
 * dependency "wave". The bars cascade like Kahn's algorithm rolling
 * across the graph — left-aligned, narrowing toward the bottom.
 */
export function BrandMark(props: { class?: string; size?: number }) {
  const size = props.size ?? 20;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      class={cx('text-accent', props.class)}
      aria-hidden="true"
    >
      <rect x="2" y="4" width="20" height="3" rx="1" fill="currentColor" opacity="0.95" />
      <rect x="2" y="9" width="15" height="3" rx="1" fill="currentColor" opacity="0.75" />
      <rect x="2" y="14" width="10" height="3" rx="1" fill="currentColor" opacity="0.55" />
      <rect x="2" y="19" width="5" height="3" rx="1" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

export function BrandLogo(props: { class?: string }) {
  return (
    <div class={cx('flex items-center gap-2', props.class)}>
      <BrandMark />
      <span class="font-mono text-sm tracking-tight font-medium text-fg-primary">orckit</span>
    </div>
  );
}
