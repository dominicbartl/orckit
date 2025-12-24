/**
 * Status Bar Component
 *
 * Displays help and status information at the bottom
 */

import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  connected: boolean;
  mode: 'normal' | 'command' | 'search';
}

export function StatusBar({ connected, mode }: StatusBarProps) {
  const connectionStatus = connected ? '● Connected' : '○ Disconnected';
  const connectionColor = connected ? 'green' : 'red';

  const modeText = mode === 'normal' ? '' : ` [${mode.toUpperCase()}]`;

  const help = 'Tab: Switch  r: Restart  s: Stop  q: Quit  ?: Help';

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Box flexGrow={1}>
        <Text color="gray">{help}</Text>
      </Box>
      <Box>
        <Text color={connectionColor}>{connectionStatus}</Text>
        <Text color="yellow">{modeText}</Text>
      </Box>
    </Box>
  );
}
