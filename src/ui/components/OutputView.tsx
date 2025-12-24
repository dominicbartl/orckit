/**
 * Output View Component
 *
 * Displays scrollable process output
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

interface OutputViewProps {
  lines: string[];
  scrollPosition: number;
  visibleLines: number;
  followMode: boolean;
}

export function OutputView({ lines, scrollPosition, visibleLines, followMode }: OutputViewProps) {
  // Get visible lines based on scroll position
  const visibleOutput = useMemo(() => {
    const start = Math.max(0, scrollPosition);
    const end = start + visibleLines;
    return lines.slice(start, end);
  }, [lines, scrollPosition, visibleLines]);

  // Calculate scroll indicators
  const hasMoreAbove = scrollPosition > 0;
  const hasMoreBelow = scrollPosition + visibleLines < lines.length;

  return (
    <Box flexDirection="column" height={visibleLines + 2}>
      {/* Scroll indicator - more above */}
      {hasMoreAbove && (
        <Box>
          <Text color="gray">▲ {scrollPosition} lines above</Text>
        </Box>
      )}

      {/* Output lines */}
      {visibleOutput.length === 0 ? (
        <Box padding={1}>
          <Text color="gray">No output yet...</Text>
        </Box>
      ) : (
        visibleOutput.map((line, index) => (
          <Box key={scrollPosition + index}>
            <Text>{line}</Text>
          </Box>
        ))
      )}

      {/* Scroll indicator - more below */}
      {hasMoreBelow && (
        <Box>
          <Text color="gray">
            ▼ {lines.length - (scrollPosition + visibleLines)} lines below
            {followMode && ' (following)'}
          </Text>
        </Box>
      )}

      {/* Follow mode indicator */}
      {!hasMoreBelow && followMode && (
        <Box>
          <Text color="green">[Following]</Text>
        </Box>
      )}
    </Box>
  );
}
