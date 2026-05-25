import chalk from 'chalk';

/**
 * Approximations of the web UI's accent palette (OKLCH → hex).
 * Keep in sync with packages/web-ui/src/styles.css `--color-accent-*`. Exact
 * hex doesn't matter — what matters is that the four bars read as a single
 * cyan/teal mark with a brightness cascade, like the SVG version.
 */
const ACCENT_BRIGHT = '#6ecedd';
const ACCENT = '#4fb8c8';
const ACCENT_DIM = '#2f8a98';
const ACCENT_SOFT = '#1b525c';

const BAR = '█';
const BAR_WIDTHS = [9, 7, 5, 2] as const;

/**
 * Render the orckit brand mark as four ANSI-colored lines. Mirrors the SVG
 * bars in `packages/web-ui/src/components/Brand.tsx`: four left-aligned bars
 * of cascading width, cyan/teal, brightest at top.
 */
export function brandMark(): string[] {
  const palette = [ACCENT_BRIGHT, ACCENT, ACCENT_DIM, ACCENT_SOFT];
  return BAR_WIDTHS.map((w, i) => chalk.hex(palette[i]!)(BAR.repeat(w)));
}

/** Visible column width of the mark (independent of ANSI codes). */
export const BRAND_MARK_WIDTH = Math.max(...BAR_WIDTHS);

/**
 * Compose the brand mark with a stack of labels rendered to its right.
 * The mark takes 4 rows; pass up to 4 labels to fill the column, or more to
 * spill below the mark with the label column kept aligned.
 *
 * Output is indented two spaces to match the rest of the dashboard.
 */
export function brandHeader(labels: string[]): string {
  const mark = brandMark();
  const rows = Math.max(mark.length, labels.length);
  const labelOffset = BRAND_MARK_WIDTH + 3; // gap between mark and labels
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    const barText = i < mark.length ? mark[i]! : '';
    const barVisibleWidth = i < BAR_WIDTHS.length ? BAR_WIDTHS[i]! : 0;
    const label = labels[i] ?? '';
    // Skip the label-column padding entirely when there's no label, so empty
    // rows don't carry trailing whitespace.
    if (label === '') {
      lines.push(`  ${barText}`);
      continue;
    }
    const pad = ' '.repeat(labelOffset - barVisibleWidth);
    lines.push(`  ${barText}${pad}${label}`);
  }
  return lines.join('\n');
}
