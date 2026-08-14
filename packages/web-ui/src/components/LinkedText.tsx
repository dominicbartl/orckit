import { For } from 'solid-js';
import type { IdeLink } from '../lib/types';
import { linkifyOutput } from '../lib/ide';
import { openInIde } from '../lib/api';
import { useToastsOptional } from '../lib/toasts';
import { cx } from '../lib/cx';

interface LinkedTextProps {
  /** Raw text to render; file references become IDE deep links. */
  text: string;
  /** IDE descriptor, or null to render plain text with no links. */
  ide: IdeLink | null;
  /** Emitting process's working dir; relative file refs resolve against it. */
  baseDir?: string;
  /** Extra classes for each link (e.g. to inherit error coloring). */
  linkClass?: string;
}

/**
 * Render a line of process output, turning file references (e.g.
 * `src/app.ts:42:10`) into clickable links that open the file in the running
 * JetBrains IDE. Falls back to plain text when no IDE was detected.
 *
 * Clicking POSTs to orckit's `/api/open` (same origin), which opens the file
 * server-side — the browser can't shell out itself. orckit routes it: files
 * inside the project root open in the IDE (via its command-line launcher),
 * files outside it (temp files, etc.) open in the OS default application. The
 * POST is same-origin, so we get a real status back and can toast accurately on
 * failure. Click stops propagation so it doesn't trigger an enclosing row's
 * select/toggle handler.
 */
export function LinkedText(props: LinkedTextProps) {
  const toasts = useToastsOptional();
  const segments = () => linkifyOutput(props.text, props.ide, props.baseDir);

  const open = (file: string, line?: number, col?: number) => {
    openInIde(file, line, col).catch((err: Error) => {
      toasts?.push({
        tone: 'warning',
        title: "Couldn't open in your IDE",
        description: err.message,
        ttl: 8000,
      });
    });
  };

  return (
    <For each={segments()}>
      {(seg) =>
        seg.kind === 'link' ? (
          <span
            role="button"
            tabindex={0}
            title={`Open ${seg.text}`}
            onClick={(e) => {
              e.stopPropagation();
              open(seg.file, seg.line, seg.col);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.stopPropagation();
              open(seg.file, seg.line, seg.col);
            }}
            class={cx(
              'underline decoration-dotted underline-offset-2 hover:decoration-solid',
              'text-hl-blue hover:text-accent cursor-pointer',
              props.linkClass,
            )}
          >
            {seg.text}
          </span>
        ) : (
          <>{seg.text}</>
        )
      }
    </For>
  );
}
