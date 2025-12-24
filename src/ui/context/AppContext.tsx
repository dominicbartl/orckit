/**
 * Global App Context
 *
 * Manages global state for the Ink TUI application
 */

import React, { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { OrckitConfig, IPCProcessInfo } from '@/types';

export interface Window {
  id: string;
  name: string;
  type: 'overview' | 'category';
  category?: string;
  processNames?: string[];
}

export interface ProcessState extends IPCProcessInfo {
  buffer: string[];  // Local buffer cache
  scrollPosition: number;
  followMode: boolean;
}

export interface AppState {
  activeWindowIndex: number;
  windows: Window[];
  processes: Map<string, ProcessState>;
  focusedPane: string | null;
  mode: 'normal' | 'command' | 'search';
  searchQuery: string;
  connected: boolean;
  config: OrckitConfig;
}

export type AppAction =
  | { type: 'WINDOW_SWITCH'; index: number }
  | { type: 'PANE_FOCUS'; processName: string | null }
  | { type: 'PROCESS_UPDATE'; processes: IPCProcessInfo[] }
  | { type: 'LOG_APPEND'; processName: string; line: string }
  | { type: 'BUFFER_SYNC'; processName: string; lines: string[] }
  | { type: 'MODE_CHANGE'; mode: 'normal' | 'command' | 'search' }
  | { type: 'SCROLL'; processName: string; delta: number }
  | { type: 'SCROLL_TO'; processName: string; position: 'top' | 'bottom' }
  | { type: 'TOGGLE_FOLLOW'; processName: string }
  | { type: 'SEARCH'; query: string }
  | { type: 'CONNECTION_STATUS'; connected: boolean }
  | { type: 'INIT_WINDOWS'; windows: Window[] };

interface AppContextValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;
}

const AppContext = createContext<AppContextValue | null>(null);

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'WINDOW_SWITCH':
      return {
        ...state,
        activeWindowIndex: Math.max(0, Math.min(action.index, state.windows.length - 1)),
        focusedPane: null,
      };

    case 'PANE_FOCUS':
      return { ...state, focusedPane: action.processName };

    case 'PROCESS_UPDATE': {
      const newProcesses = new Map(state.processes);

      for (const proc of action.processes) {
        const existing = newProcesses.get(proc.name);
        newProcesses.set(proc.name, {
          ...proc,
          buffer: existing?.buffer ?? [],
          scrollPosition: existing?.scrollPosition ?? 0,
          followMode: existing?.followMode ?? true,
        });
      }

      return { ...state, processes: newProcesses };
    }

    case 'LOG_APPEND': {
      const newProcesses = new Map(state.processes);
      const process = newProcesses.get(action.processName);

      if (process) {
        const newBuffer = [...process.buffer, action.line];
        newProcesses.set(action.processName, {
          ...process,
          buffer: newBuffer,
          // Auto-scroll if follow mode is enabled
          scrollPosition: process.followMode ?
            Math.max(0, newBuffer.length - 20) : // Show last 20 lines
            process.scrollPosition,
        });
      }

      return { ...state, processes: newProcesses };
    }

    case 'BUFFER_SYNC': {
      const newProcesses = new Map(state.processes);
      const process = newProcesses.get(action.processName);

      if (process) {
        newProcesses.set(action.processName, {
          ...process,
          buffer: action.lines,
          scrollPosition: process.followMode ?
            Math.max(0, action.lines.length - 20) :
            process.scrollPosition,
        });
      }

      return { ...state, processes: newProcesses };
    }

    case 'MODE_CHANGE':
      return { ...state, mode: action.mode };

    case 'SCROLL': {
      const newProcesses = new Map(state.processes);
      const process = newProcesses.get(action.processName);

      if (process) {
        const newPosition = Math.max(
          0,
          Math.min(process.scrollPosition + action.delta, Math.max(0, process.buffer.length - 20))
        );
        newProcesses.set(action.processName, {
          ...process,
          scrollPosition: newPosition,
          followMode: false, // Disable follow mode when manually scrolling
        });
      }

      return { ...state, processes: newProcesses };
    }

    case 'SCROLL_TO': {
      const newProcesses = new Map(state.processes);
      const process = newProcesses.get(action.processName);

      if (process) {
        const newPosition = action.position === 'top' ?
          0 :
          Math.max(0, process.buffer.length - 20);

        newProcesses.set(action.processName, {
          ...process,
          scrollPosition: newPosition,
          followMode: action.position === 'bottom',
        });
      }

      return { ...state, processes: newProcesses };
    }

    case 'TOGGLE_FOLLOW': {
      const newProcesses = new Map(state.processes);
      const process = newProcesses.get(action.processName);

      if (process) {
        const newFollowMode = !process.followMode;
        newProcesses.set(action.processName, {
          ...process,
          followMode: newFollowMode,
          scrollPosition: newFollowMode ?
            Math.max(0, process.buffer.length - 20) :
            process.scrollPosition,
        });
      }

      return { ...state, processes: newProcesses };
    }

    case 'SEARCH':
      return { ...state, searchQuery: action.query };

    case 'CONNECTION_STATUS':
      return { ...state, connected: action.connected };

    case 'INIT_WINDOWS':
      return { ...state, windows: action.windows };

    default:
      return state;
  }
}

export function AppProvider({ children, config }: { children: React.ReactNode; config: OrckitConfig }) {
  const initialState: AppState = {
    activeWindowIndex: 0,
    windows: [],
    processes: new Map(),
    focusedPane: null,
    mode: 'normal',
    searchQuery: '',
    connected: false,
    config,
  };

  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
}
