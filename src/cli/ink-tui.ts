/**
 * Ink TUI Launch Entry Point
 *
 * Renders the Ink-based TUI
 */

import type { OrckitConfig } from '@/types';

export interface LaunchInkTUIOptions {
  socketPath: string;
  config: OrckitConfig;
}

export async function launchInkTUI(options: LaunchInkTUIOptions): Promise<void> {
  // Dynamic import to avoid loading Ink when not needed
  const { render } = await import('ink');
  const React = await import('react');
  const { App } = await import('../ui/App.js');

  const { waitUntilExit } = render(
    React.createElement(App, {
      socketPath: options.socketPath,
      config: options.config,
    })
  );

  // Wait for user to exit
  await waitUntilExit();
}
