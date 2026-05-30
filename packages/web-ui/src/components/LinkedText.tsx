import { For } from 'solid-js';
import type { IdeLink } from '../lib/types';
import { linkifyOutput } from '../lib/ide';
import { cx } from '../lib/cx';

interface LinkedTextProps {
  /** Raw text to render; file references become `jetbrains://` links. */
  text: string;
  /** IDE descriptor, or null to render plain text with no links. */
  ide: IdeLink | null;
  /** Emitting process's working dir; relative file refs resolve against it. */
  baseDir?: string;
  /** Extra classes for each link anchor (e.g. to inherit error coloring). */
  linkClass?: string;
}

/**
 * Render a line of process output, turning file references (e.g.
 * `src/app.ts:42:10`) into clickable JetBrains deep links. Falls back to plain
 * text when no IDE was detected. Clicks on a link stop propagation so they
 * don't trigger an enclosing row's select/toggle handler.
 */
export function LinkedText(props: LinkedTextProps) {
  const segments = () => linkifyOutput(props.text, props.ide, props.baseDir);
  return (
    <For each={segments()}>
      {(seg) =>
        seg.kind === 'link' ? (
          <a
            href={seg.href}
            onClick={(e) => e.stopPropagation()}
            title={`Open in IDE — ${seg.text}`}
            class={cx(
              'underline decoration-dotted underline-offset-2 hover:decoration-solid',
              'text-hl-blue hover:text-accent cursor-pointer',
              props.linkClass,
            )}
          >
            {seg.text}
          </a>
        ) : (
          <>{seg.text}</>
        )
      }
    </For>
  );
}
