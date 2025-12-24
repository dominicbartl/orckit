/**
 * Category Window Component
 *
 * Displays processes from a category with split panes
 */

import React, { useMemo } from 'react';
import { Box } from 'ink';
import { ProcessPane } from '../components/ProcessPane.js';
import { PaneLayoutManager } from '../layout/PaneLayoutManager.js';
import type { ProcessState } from '../context/AppContext.js';

interface CategoryWindowProps {
  category: string;
  processNames: string[];
  processes: Map<string, ProcessState>;
  focusedPane: string | null;
}

export function CategoryWindow({
  processNames,
  processes,
  focusedPane,
}: CategoryWindowProps) {
  const layoutManager = useMemo(() => new PaneLayoutManager(), []);

  const layouts = useMemo(
    () => layoutManager.calculateLayout(processNames),
    [layoutManager, processNames]
  );

  const rows = useMemo(
    () => layoutManager.groupByRow(layouts),
    [layoutManager, layouts]
  );

  return (
    <Box flexDirection="column" height="100%">
      {rows.map((rowPanes, rowIndex) => (
        <Box key={rowIndex} flexGrow={1}>
          {rowPanes.map((paneLayout) => {
            const process = processes.get(paneLayout.processName);
            if (!process) {
              return null;
            }

            const isFocused = focusedPane === paneLayout.processName;

            return (
              <ProcessPane
                key={paneLayout.processName}
                process={process}
                focused={isFocused}
                height={paneLayout.height}
                width={paneLayout.width}
              />
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
