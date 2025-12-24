/**
 * Overview Window Component
 *
 * Displays a table of all processes with their status
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ProcessState } from '../context/AppContext.js';

interface OverviewWindowProps {
  processes: Map<string, ProcessState>;
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
  if (!milliseconds) return '-';

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

function formatBuildInfo(buildInfo?: ProcessState['buildInfo']): string {
  if (!buildInfo) return '-';

  const progress = buildInfo.progress ?? 0;
  const errors = buildInfo.errors ?? 0;
  const warnings = buildInfo.warnings ?? 0;

  return `${progress}% E:${errors} W:${warnings}`;
}

export function OverviewWindow({ processes }: OverviewWindowProps) {
  const processArray = Array.from(processes.values());

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box>
        <Box width={20}>
          <Text bold color="cyan">Process</Text>
        </Box>
        <Box width={12}>
          <Text bold color="cyan">Status</Text>
        </Box>
        <Box width={10}>
          <Text bold color="cyan">PID</Text>
        </Box>
        <Box width={12}>
          <Text bold color="cyan">Uptime</Text>
        </Box>
        <Box width={10}>
          <Text bold color="cyan">Restarts</Text>
        </Box>
        <Box width={15}>
          <Text bold color="cyan">Category</Text>
        </Box>
        <Box width={20}>
          <Text bold color="cyan">Build</Text>
        </Box>
      </Box>

      {/* Separator */}
      <Box>
        <Text color="gray">{'─'.repeat(99)}</Text>
      </Box>

      {/* Process rows */}
      {processArray.length === 0 ? (
        <Box marginY={1}>
          <Text color="gray">No processes running</Text>
        </Box>
      ) : (
        processArray.map((process) => {
          const statusIcon = STATUS_ICONS[process.status] || '?';
          const statusColor = STATUS_COLORS[process.status] || 'white';

          return (
            <Box key={process.name}>
              <Box width={20}>
                <Text>{process.name}</Text>
              </Box>
              <Box width={12}>
                <Text color={statusColor}>
                  {statusIcon} {process.status}
                </Text>
              </Box>
              <Box width={10}>
                <Text>{process.pid ?? '-'}</Text>
              </Box>
              <Box width={12}>
                <Text>{formatUptime(process.uptime)}</Text>
              </Box>
              <Box width={10}>
                <Text>{process.restartCount}</Text>
              </Box>
              <Box width={15}>
                <Text>{process.category}</Text>
              </Box>
              <Box width={20}>
                <Text>{formatBuildInfo(process.buildInfo)}</Text>
              </Box>
            </Box>
          );
        })
      )}

      {/* Log area placeholder */}
      <Box marginTop={2} borderStyle="single" borderColor="gray" padding={1}>
        <Text color="gray">Logs (feature coming soon)</Text>
      </Box>
    </Box>
  );
}
