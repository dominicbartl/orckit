/**
 * Pane Layout Manager
 *
 * Calculates pane positions and sizes for split pane layout
 */

export interface PaneLayout {
  processName: string;
  width: string;    // e.g., "50%"
  height: string;   // e.g., "100%"
  x: number;        // Relative position (0-based)
  y: number;        // Relative position (0-based)
}

export class PaneLayoutManager {
  /**
   * Calculate layout for split panes
   *
   * Layout strategies:
   * - 1 pane: 100% width, 100% height
   * - 2 panes: 50% vertical split
   * - 3 panes: L-shape (50% left, 25% top-right, 25% bottom-right)
   * - 4 panes: 2x2 grid
   * - 5+ panes: Dynamic grid
   */
  calculateLayout(processNames: string[]): PaneLayout[] {
    const count = processNames.length;

    if (count === 0) {
      return [];
    }

    if (count === 1) {
      return [
        {
          processName: processNames[0],
          width: '100%',
          height: '100%',
          x: 0,
          y: 0,
        },
      ];
    }

    if (count === 2) {
      return [
        {
          processName: processNames[0],
          width: '50%',
          height: '100%',
          x: 0,
          y: 0,
        },
        {
          processName: processNames[1],
          width: '50%',
          height: '100%',
          x: 1,
          y: 0,
        },
      ];
    }

    if (count === 3) {
      // L-shape layout
      return [
        {
          processName: processNames[0],
          width: '50%',
          height: '100%',
          x: 0,
          y: 0,
        },
        {
          processName: processNames[1],
          width: '50%',
          height: '50%',
          x: 1,
          y: 0,
        },
        {
          processName: processNames[2],
          width: '50%',
          height: '50%',
          x: 1,
          y: 1,
        },
      ];
    }

    if (count === 4) {
      // 2x2 grid
      return [
        {
          processName: processNames[0],
          width: '50%',
          height: '50%',
          x: 0,
          y: 0,
        },
        {
          processName: processNames[1],
          width: '50%',
          height: '50%',
          x: 1,
          y: 0,
        },
        {
          processName: processNames[2],
          width: '50%',
          height: '50%',
          x: 0,
          y: 1,
        },
        {
          processName: processNames[3],
          width: '50%',
          height: '50%',
          x: 1,
          y: 1,
        },
      ];
    }

    // 5+ panes: Dynamic grid
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const layouts: PaneLayout[] = [];

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);

      layouts.push({
        processName: processNames[i],
        width: `${100 / cols}%`,
        height: `${100 / rows}%`,
        x: col,
        y: row,
      });
    }

    return layouts;
  }

  /**
   * Group layouts by row for rendering
   */
  groupByRow(layouts: PaneLayout[]): PaneLayout[][] {
    const rows = new Map<number, PaneLayout[]>();

    for (const layout of layouts) {
      if (!rows.has(layout.y)) {
        rows.set(layout.y, []);
      }
      rows.get(layout.y)!.push(layout);
    }

    // Sort rows by y position
    const sortedRows = Array.from(rows.entries()).sort(([a], [b]) => a - b);

    return sortedRows.map(([, panes]) => {
      // Sort panes within row by x position
      return panes.sort((a, b) => a.x - b.x);
    });
  }
}
