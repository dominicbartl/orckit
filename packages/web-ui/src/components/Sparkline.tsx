import { createMemo } from 'solid-js';
import { cx } from '../lib/cx';

/**
 * Minimal SVG sparkline — used for things like log volume over time or restart
 * counts. Designed to look like a "wave" silhouette continuing the brand
 * motif. Self-normalizes against the data range.
 */
export function Sparkline(props: {
  values: number[];
  width?: number;
  height?: number;
  class?: string;
  /** Optional override; defaults to the accent color. */
  stroke?: string;
}) {
  const width = () => props.width ?? 100;
  const height = () => props.height ?? 24;

  const path = createMemo(() => {
    const vs = props.values;
    if (vs.length === 0) return '';
    const min = Math.min(...vs);
    const max = Math.max(...vs);
    const range = max - min || 1;
    const stepX = vs.length === 1 ? 0 : width() / (vs.length - 1);
    return vs
      .map((v, i) => {
        const x = i * stepX;
        const y = height() - ((v - min) / range) * (height() - 4) - 2;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  });

  return (
    <svg
      width={width()}
      height={height()}
      viewBox={`0 0 ${width()} ${height()}`}
      class={cx('overflow-visible', props.class)}
      aria-hidden="true"
    >
      <path
        d={path()}
        fill="none"
        stroke={props.stroke ?? 'currentColor'}
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class={!props.stroke ? 'text-accent' : undefined}
      />
    </svg>
  );
}
