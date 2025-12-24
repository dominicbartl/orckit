/**
 * Pane Header Component
 *
 * Displays title bar for a process pane
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ProcessState } from '../context/AppContext.js';

interface PaneHeaderProps {
  process: ProcessState;
  focused: boolean;
}

const STATUS_ICONS: Record<string, string> = {
  pending: '⏳',
  starting: '⚙️',
  running: '✅',
  building: '🔨',
  failed: '❌',
  stopped: '⏹️',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'yellow',
  starting: 'cyan',
  running: 'green',
  building: 'blue',
  failed: 'red',
  stopped: 'gray',
};

function formatUptime(milliseconds?: number): string {
  if (!milliseconds) return '';

  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

export function PaneHeader({ process, focused }: PaneHeaderProps) {
  const statusIcon = STATUS_ICONS[process.status] || '?';
  const statusColor = STATUS_COLORS[process.status] || 'white';
  const borderColor = focused ? 'cyan' : 'gray';

  const uptime = formatUptime(process.uptime);
  const pid = process.pid ? `PID: ${process.pid}` : '';

  return (
    <Box borderStyle="single" borderColor={borderColor} paddingX={1}>
      <Box flexGrow={1}>
        <Text bold color={focused ? 'cyan' : 'white'}>
          {process.name}
        </Text>
        <Text color={statusColor}> [{statusIcon} {process.status}]</Text>
      </Box>
      <Box>
        {pid && <Text color="gray">{pid} </Text>}
        {uptime && <Text color="gray">{uptime}</Text>}
      </Box>
    </Box>
  );
}
