import { type Accessor, For, createEffect, createSignal, on, onCleanup } from 'solid-js';
import { cx } from '../lib/cx';
import type { OutputLine } from '../lib/types';

const HIGHLIGHT_CLASS: Record<string, string> = {
  red: 'text-hl-red',
  green: 'text-hl-green',
  yellow: 'text-hl-yellow',
  blue: 'text-hl-blue',
  magenta: 'text-hl-magenta',
  cyan: 'text-hl-cyan',
  gray: 'text-hl-gray',
};

interface LogViewProps {
  lines: Accessor<OutputLine[]>;
  /** Show stream-source dot (stdout/stderr) before each line. Default true. */
  showStreamIndicator?: boolean;
  /** Auto-scroll to bottom on new lines when user is at bottom. Default true. */
  autoStick?: boolean;
  /** ARIA label / empty hint. */
  emptyHint?: string;
  class?: string;
}

/**
 * Append-only log viewer optimized for high-volume streams.
 *
 * Strategy: render the full list with a `<For>` (Solid's keyed list does the
 * minimum work on append), and auto-scroll to bottom only when the user is
 * already pinned there. Scrolling up disengages auto-stick — pinning back
 * to the bottom re-engages it.
 *
 * Virtualization is intentionally deferred. orckit caps the output buffer per
 * process (default 1000 lines), so even with a few processes streaming the
 * DOM stays manageable. Add windowing if the cap grows.
 */
export function LogView(props: LogViewProps) {
  let viewport: HTMLDivElement | undefined;
  const [stuck, setStuck] = createSignal(true);

  const handleScroll = () => {
    if (!viewport) return;
    const distanceFromBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    setStuck(distanceFromBottom < 4);
  };

  createEffect(
    on(props.lines, () => {
      if (!viewport) return;
      if (props.autoStick === false) return;
      if (!stuck()) return;
      // Defer to next frame so the new line is laid out before we scroll.
      requestAnimationFrame(() => {
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
      });
    }),
  );

  onCleanup(() => {
    viewport = undefined;
  });

  return (
    <div
      ref={viewport}
      onScroll={handleScroll}
      class={cx(
        'relative h-full overflow-y-auto bg-surface-inset rounded-md',
        'border border-border-subtle',
        'font-mono text-[12px] leading-[1.45]',
        props.class,
      )}
    >
      <div class="py-2">
        <For
          each={props.lines()}
          fallback={
            <div class="px-3 py-6 text-fg-tertiary text-xs text-center">
              {props.emptyHint ?? 'no output yet'}
            </div>
          }
        >
          {(line) => <LogLine line={line} showStreamIndicator={props.showStreamIndicator} />}
        </For>
      </div>
    </div>
  );
}

function LogLine(props: { line: OutputLine; showStreamIndicator?: boolean }) {
  const colorClass = () =>
    props.line.highlight
      ? (HIGHLIGHT_CLASS[props.line.highlight] ?? '')
      : props.line.stream === 'stderr'
        ? 'text-stream-stderr'
        : 'text-stream-stdout';

  return (
    <div class="group flex items-start gap-2 px-3 hover:bg-surface-1/50">
      {props.showStreamIndicator !== false && (
        <span
          class={cx(
            'flex-shrink-0 mt-[6px] inline-block h-1 w-1 rounded-full',
            props.line.stream === 'stderr' ? 'bg-status-failed' : 'bg-fg-disabled',
          )}
          aria-label={props.line.stream}
        />
      )}
      <span class={cx('whitespace-pre-wrap break-all flex-1', colorClass())}>{props.line.text}</span>
    </div>
  );
}
