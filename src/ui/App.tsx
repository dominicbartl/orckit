/**
 * Main Ink App Component
 */

import React, { useEffect, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { AppProvider, useAppContext, type Window } from './context/AppContext.js';
import { useIPCConnection } from './hooks/useIPCConnection.js';
import { TabBar } from './components/TabBar.js';
import { StatusBar } from './components/StatusBar.js';
import { WindowRouter } from './windows/WindowRouter.js';
import type { OrckitConfig } from '@/types';

interface AppProps {
  socketPath: string;
  config: OrckitConfig;
}

function AppContent({ socketPath }: { socketPath: string }) {
  const { state, dispatch } = useAppContext();
  const { exit } = useApp();

  // Connect to IPC server
  const { sendCommand } = useIPCConnection({
    socketPath,
    onMessage: (action) => dispatch(action),
    onConnected: () => dispatch({ type: 'CONNECTION_STATUS', connected: true }),
    onDisconnected: () => dispatch({ type: 'CONNECTION_STATUS', connected: false }),
  });

  // Initialize windows when processes are loaded
  useEffect(() => {
    if (state.processes.size > 0 && state.windows.length === 0) {
      const windows: Window[] = [
        {
          id: 'overview',
          name: 'Overview',
          type: 'overview',
        },
      ];

      // Group processes by category
      const categories = new Map<string, string[]>();
      for (const [name, process] of state.processes) {
        const cat = process.category || 'default';
        if (!categories.has(cat)) {
          categories.set(cat, []);
        }
        categories.get(cat)!.push(name);
      }

      // Create window for each category
      for (const [category, processNames] of categories) {
        windows.push({
          id: category,
          name: category.charAt(0).toUpperCase() + category.slice(1),
          type: 'category',
          category,
          processNames,
        });
      }

      dispatch({ type: 'INIT_WINDOWS', windows });
    }
  }, [state.processes, state.windows.length, dispatch]);

  // Keyboard input handling
  useInput((input, key) => {
    if (state.mode === 'normal') {
      // Global shortcuts
      if (input === 'q') {
        exit();
        return;
      }

      if (key.tab) {
        dispatch({
          type: 'WINDOW_SWITCH',
          index: (state.activeWindowIndex + 1) % state.windows.length,
        });
        return;
      }

      // Window switching with Ctrl+1-9
      if (key.ctrl && input >= '1' && input <= '9') {
        const index = parseInt(input, 10) - 1;
        dispatch({ type: 'WINDOW_SWITCH', index });
        return;
      }

      // Send commands for focused pane
      if (state.focusedPane) {
        if (input === 'r') {
          sendCommand('restart', state.focusedPane);
          return;
        }
        if (input === 's') {
          sendCommand('stop', state.focusedPane);
          return;
        }
      }

      // Search mode
      if (input === '/') {
        dispatch({ type: 'MODE_CHANGE', mode: 'search' });
        return;
      }
    }

    // Escape key - return to normal mode
    if (key.escape) {
      dispatch({ type: 'MODE_CHANGE', mode: 'normal' });
    }
  });

  // Get active window
  const activeWindow = state.windows[state.activeWindowIndex];

  return (
    <Box flexDirection="column" height="100%">
      {/* Tab Bar */}
      <TabBar windows={state.windows} activeIndex={state.activeWindowIndex} />

      {/* Active Window Content */}
      <Box flexGrow={1}>
        {activeWindow ? (
          <WindowRouter
            window={activeWindow}
            processes={state.processes}
            focusedPane={state.focusedPane}
          />
        ) : (
          <Box padding={1}>
            <Text color="gray">Loading...</Text>
          </Box>
        )}
      </Box>

      {/* Status Bar */}
      <StatusBar connected={state.connected} mode={state.mode} />
    </Box>
  );
}

export function App({ socketPath, config }: AppProps) {
  return (
    <AppProvider config={config}>
      <AppContent socketPath={socketPath} />
    </AppProvider>
  );
}
