/**
 * Process Buffer Hook
 *
 * Subscribe to buffer for a specific process
 */

import { useMemo } from 'react';
import { useAppContext } from '../context/AppContext.js';

export interface ProcessBuffer {
  lines: string[];
  totalLines: number;
}

export function useProcessBuffer(processName: string): ProcessBuffer {
  const { state } = useAppContext();
  const process = state.processes.get(processName);

  return useMemo(
    () => ({
      lines: process?.buffer ?? [],
      totalLines: process?.buffer.length ?? 0,
    }),
    [process?.buffer]
  );
}
