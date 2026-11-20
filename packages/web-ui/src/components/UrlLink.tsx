import { IconExternal } from '../lib/icons';
import { cx } from '../lib/cx';

/**
 * A process's root URL as an external link (new tab). Shown without the
 * scheme to stay compact; the full URL is in the tooltip. `live` is false while
 * the process isn't serving (pending, booting, stopped, failed) — the link
 * still works but reads as dimmed.
 */
export function UrlLink(props: { url: string; live?: boolean; class?: string }) {
  const label = () => props.url.replace(/^https?:\/\//, '');
  return (
    <a
      href={props.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${props.url}`}
      onClick={(e) => e.stopPropagation()}
      class={cx(
        'inline-flex items-center gap-1 min-w-0 font-mono text-[12px] rounded',
        'underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        props.live === false
          ? 'text-fg-tertiary hover:text-fg-secondary'
          : 'text-accent hover:text-accent-bright',
        props.class,
      )}
    >
      <span class="truncate">{label()}</span>
      <IconExternal width={12} height={12} class="flex-shrink-0" />
    </a>
  );
}
