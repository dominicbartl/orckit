/**
 * UI Plugin interface
 *
 * UIs run in same process as Orckit, listen to events, call methods directly.
 */

import type { Orckit } from '../core/orckit.js';

/**
 * UI Plugin interface
 */
export interface UIPlugin {
  /** Plugin name (e.g., 'http', 'cli') */
  name: string;

  /**
   * Initialize plugin with Orckit instance
   * Register event listeners here
   */
  init(orckit: Orckit): void;

  /**
   * Start the UI (called after Orckit starts)
   * For HTTP: start server
   * For CLI: nothing to do
   */
  start(): Promise<void>;

  /**
   * Stop the UI
   * For HTTP: close server
   * For CLI: nothing to do
   */
  stop(): Promise<void>;
}

export interface UIPluginOptions {
  [key: string]: unknown;
}
