/**
 * CLI UI Plugin
 *
 * Simple console output (traditional CLI behavior)
 */

import type { UIPlugin } from './plugin.js';
import type { Orckit } from '../core/orckit.js';
import { BootLogger } from '../core/boot/logger.js';
import chalk from 'chalk';

export interface CLIPluginOptions {
  style?: 'timeline' | 'minimal' | 'quiet';
}

export class CLIPlugin implements UIPlugin {
  name = 'cli';
  private orckit: Orckit | null = null;
  private bootLogger: BootLogger;
  private style: 'timeline' | 'minimal' | 'quiet';

  constructor(options: CLIPluginOptions = {}) {
    this.style = options.style ?? 'timeline';
    this.bootLogger = new BootLogger(this.style);
  }

  init(orckit: Orckit): void {
    this.orckit = orckit;

    // Boot logger handles its own events during startup
    // We only listen to runtime events here

    orckit.on('process:failed', (event) => {
      console.log(chalk.red(`✗  ${event.processName} failed`));
      if (event.error) {
        console.log(chalk.red(`   ${event.error.message}`));
      }
    });

    orckit.on('process:stopped', (event) => {
      console.log(chalk.gray(`  ${event.processName} stopped`));
    });

    orckit.on('process:restarting', (event) => {
      console.log(chalk.yellow(`  ↻  ${event.processName} restarting (attempt ${event.restartCount + 1})`));
    });
  }

  async start(): Promise<void> {
    // CLI is synchronous, nothing to start
  }

  async stop(): Promise<void> {
    // Nothing to stop
  }

  /**
   * Get the boot logger for Orckit to use during startup
   */
  getBootLogger(): BootLogger {
    return this.bootLogger;
  }
}
