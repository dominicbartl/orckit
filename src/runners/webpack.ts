/**
 * Webpack process runner with deep integration
 */

import { ProcessRunner } from './base.js';
import type { ProcessConfig, BuildInfo } from '../types/index.js';

/**
 * Webpack runner with deep integration support
 */
export class WebpackRunner extends ProcessRunner {
  private buildStartTime: number | null = null;

  /**
   * Override start to set initial status to 'building' instead of 'running'
   */
  async start(): Promise<void> {
    await super.start();
    // Override status to 'building' for webpack processes
    if (this._status === 'running') {
      this.updateStatus('building');
    }
  }

  /**
   * Override parseOutputLine to parse webpack build output
   */
  protected parseOutputLine(line: string, _isStderr: boolean): void {
    // Detect build start
    if (line.includes('webpack') && line.includes('compiling')) {
      this.buildStartTime = Date.now();
      this.updateStatus('building');
      this.emit('build:start');
    }

    // Parse progress (if using ProgressPlugin)
    const progressMatch = line.match(/(\d+)%/);
    if (progressMatch) {
      const progress = parseInt(progressMatch[1], 10);
      this.emit('build:progress', { progress });
    }

    // Detect build complete
    if (line.includes('webpack') && line.includes('compiled')) {
      const duration = this.buildStartTime ? Date.now() - this.buildStartTime : 0;

      // Parse errors and warnings
      const errorMatch = line.match(/(\d+)\s+error/);
      const warningMatch = line.match(/(\d+)\s+warning/);

      const errors = errorMatch ? parseInt(errorMatch[1], 10) : 0;
      const warnings = warningMatch ? parseInt(warningMatch[1], 10) : 0;

      // Parse bundle size
      const sizeMatch = line.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB)/i);
      const size = sizeMatch ? `${sizeMatch[1]}${sizeMatch[2]}` : undefined;

      const buildInfo: BuildInfo = {
        duration,
        errors,
        warnings,
        size,
        lastBuildSuccess: errors === 0,
      };

      this.updateBuildInfo(buildInfo);
      this.updateStatus(errors === 0 ? 'running' : 'failed');
      this.emit('build:complete', { buildInfo, duration });
    }

    // Detect build failure
    if (line.includes('Failed to compile') || line.includes('ERROR in')) {
      this.updateStatus('failed');
      this.emit('build:failed');
    }
  }
}
