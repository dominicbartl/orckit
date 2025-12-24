/**
 * Tab Bar Component
 *
 * Displays window tabs at the top of the TUI
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { Window } from '../context/AppContext.js';

interface TabBarProps {
  windows: Window[];
  activeIndex: number;
}

export function TabBar({ windows, activeIndex }: TabBarProps) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      {windows.map((window, index) => {
        const isActive = index === activeIndex;
        const color = isActive ? 'cyan' : 'gray';
        const bgColor = isActive ? 'cyan' : undefined;
        const prefix = isActive ? '>' : ' ';

        return (
          <Box key={window.id} marginRight={1}>
            <Text color={color} backgroundColor={bgColor} bold={isActive}>
              {prefix} {window.name}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
