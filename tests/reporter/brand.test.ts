import { describe, expect, it } from 'vitest';
import { brandHeader, brandMark, BRAND_MARK_WIDTH } from '../../src/reporter/brand.js';
import { stripAnsi } from '../../src/process/parsers.js';

describe('brandMark', () => {
  it('renders four bars with cascading width (widest first)', () => {
    const lines = brandMark().map(stripAnsi);
    expect(lines).toHaveLength(4);
    const widths = lines.map((l) => l.length);
    expect(widths).toEqual([9, 7, 5, 2]);
    expect(BRAND_MARK_WIDTH).toBe(9);
    for (const line of lines) expect(line).toMatch(/^█+$/);
  });
});

describe('brandHeader', () => {
  it('aligns labels to a column past the widest bar', () => {
    const out = stripAnsi(brandHeader(['orckit', 'my-app']));
    const rows = out.split('\n');
    expect(rows).toHaveLength(4);
    // First two rows have labels; columns should align past the bar width.
    const labelColumn = rows[0]!.indexOf('orckit');
    expect(labelColumn).toBeGreaterThan(BRAND_MARK_WIDTH);
    expect(rows[1]!.indexOf('my-app')).toBe(labelColumn);
    // Last rows have no label — should be just bars + padding (no trailing text).
    expect(rows[3]!.trimEnd()).toMatch(/^\s+█+$/);
  });

  it('spills additional labels below the mark with aligned indentation', () => {
    const out = stripAnsi(
      brandHeader(['orckit', 'my-app', 'web  http://x', 'mcp  http://y', 'logs /tmp']),
    );
    const rows = out.split('\n');
    expect(rows).toHaveLength(5);
    // Fifth row has no bar — the label sits at the same column as previous rows.
    const labelColumn = rows[0]!.indexOf('orckit');
    expect(rows[4]!.indexOf('logs')).toBe(labelColumn);
  });
});
