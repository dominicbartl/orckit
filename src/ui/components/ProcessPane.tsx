/**
 * Process Pane Component
 *
 * Displays individual process output with header and scrolling
 */

import React from 'react';
import { Box } from 'ink';
import { PaneHeader } from './PaneHeader.js';
import { OutputView } from './OutputView.js';
import { useScroll } from '../hooks/useScroll.js';
import { useProcessBuffer } from '../hooks/useProcessBuffer.js';
import type { ProcessState } from '../context/AppContext.js';

interface ProcessPaneProps {
  process: ProcessState;
  focused: boolean;
  height: string;
  width: string;
}

export function ProcessPane({ process, focused, height, width }: ProcessPaneProps) {
  const buffer = useProcessBuffer(process.name);
  const scroll = useScroll(process.name, 15); // Show 15 lines

  return (
    <Box flexDirection="column" height={height} width={width}>
      <PaneHeader process={process} focused={focused} />
      <OutputView
        lines={buffer.lines}
        scrollPosition={scroll.position}
        visibleLines={scroll.visibleLines}
        followMode={scroll.followMode}
      />
    </Box>
  );
}
