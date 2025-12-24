/**
 * Window Router Component
 *
 * Routes to the active window based on state
 */

import React from 'react';
import { OverviewWindow } from './OverviewWindow.js';
import { CategoryWindow } from './CategoryWindow.js';
import type { Window, ProcessState } from '../context/AppContext.js';

interface WindowRouterProps {
  window: Window;
  processes: Map<string, ProcessState>;
  focusedPane: string | null;
}

export function WindowRouter({ window, processes, focusedPane }: WindowRouterProps) {
  if (window.type === 'overview') {
    return <OverviewWindow processes={processes} />;
  }

  if (window.type === 'category') {
    return (
      <CategoryWindow
        category={window.category!}
        processNames={window.processNames ?? []}
        processes={processes}
        focusedPane={focusedPane}
      />
    );
  }

  return null;
}
