/**
 * Angular CLI runner with JSON output parsing
 */

import { ProcessRunner } from './base.js';
import type { ProcessConfig, BuildInfo } from '../types/index.js';

/**
 * Angular CLI runner
 */
export class AngularRunner extends ProcessRunner {
  /**
   * Override start to set initial status to 'building' instead of 'running'
   */
  async start(): Promise<void> {
    await super.start();
    // Override status to 'building' for Angular processes
    if (this._status === 'running') {
      this.updateStatus('building');
    }
  }

  /**
   * Override parseOutputLine to parse Angular CLI output
   */
  protected parseOutputLine(line: string, _isStderr: boolean): void {
    // Strip ANSI color codes before parsing
    const cleanLine = this.stripAnsiCodes(line);
    this.parseAngularText(cleanLine);
  }

  /**
   * Strip ANSI escape codes from string
   */
  private stripAnsiCodes(str: string): string {
    // eslint-disable-next-line no-control-regex
    return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
  }

  /**
   * Parse Angular text output (fallback)
   */
  private parseAngularText(line: string): void {
    // Detect compilation start
    if (line.includes('Compiling') || line.includes('Building') ||
        line.includes('Generating browser application bundles')) {
      this.updateStatus('building');
      this.emit('build:start');
    }

    // Parse progress
    const progressMatch = line.match(/(\d+)%/);
    if (progressMatch) {
      const progress = parseInt(progressMatch[1], 10);
      this.emit('build:progress', { progress });
    }

    // Detect successful build - Angular CLI newer patterns
    if (line.includes('Compiled successfully') ||
        line.includes('Build complete') ||
        line.includes('✔ Browser application bundle generation complete') ||
        line.includes('✔ Index html generation complete') ||
        line.match(/Build at:.*Time:\s*\d+ms/)) {

      // Extract build time if available
      const timeMatch = line.match(/Time:\s*(\d+)ms/);
      const duration = timeMatch ? parseInt(timeMatch[1], 10) : undefined;

      const buildInfo: BuildInfo = {
        duration,
        errors: 0,
        warnings: 0,
        lastBuildSuccess: true,
      };

      this.updateBuildInfo(buildInfo);
      this.updateStatus('running');
      this.emit('build:complete', { buildInfo });
    }

    // Detect errors
    if (line.includes('ERROR') || line.includes('Failed to compile') ||
        line.includes('✖') || line.includes('Build failed')) {
      this.updateStatus('failed');
      this.emit('build:failed');
    }
  }
}
