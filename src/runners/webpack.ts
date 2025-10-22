/**
 * Webpack process runner with deep integration
 */

import { execa } from 'execa';
import { ProcessRunner } from './base.js';
import { getProcessEnv } from '../utils/system.js';
import type { BuildInfo } from '../types/index.js';

/**
 * Webpack runner with deep integration support
 */
export class WebpackRunner extends ProcessRunner {
  async start(): Promise<void> {
    if (this.process) {
      throw new Error(`Process ${this.name} is already running`);
    }

    this.updateStatus('starting');
    this.startTime = new Date();

    const cwd = this.config.cwd ?? process.cwd();
    const env = getProcessEnv(this.config.env);

    // Execute webpack command
    this.process = execa('bash', ['-c', this.config.command], {
      cwd,
      env,
      reject: false,
      all: true,
    });

    this._pid = this.process.pid ?? null;

    const buildStartTime: number | null = null;

    // Handle stdout - parse webpack output
    this.process.stdout?.on('data', (data: Buffer) => {
      const line = data.toString();
      this.emit('stdout', line);

      // Parse webpack output for build info
      this.parseWebpackOutput(line, buildStartTime);
    });

    // Handle stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      const line = data.toString();
      this.emit('stderr', line);
    });

    // Handle exit
    void this.process.on('exit', (code, signal) => {
      this.stopTime = new Date();
      this._pid = null;

      if (code === 0) {
        this.updateStatus('stopped');
        this.emit('exit', code, signal);
      } else {
        this.updateStatus('failed');
        this.emit('failed', code, signal);
      }
    });

    // Process started successfully
    this.updateStatus('building');
  }

  /**
   * Parse webpack output for build information
   */
  private parseWebpackOutput(line: string, buildStartTime: number | null): void {
    // Detect build start
    if (line.includes('webpack') && line.includes('compiling')) {
      buildStartTime = Date.now();
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
      const duration = buildStartTime ? Date.now() - buildStartTime : 0;

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

  async stop(): Promise<void> {
    if (!this.process || !this.process.pid) {
      return;
    }

    // Try graceful shutdown first
    this.process.kill('SIGTERM');

    // Wait up to 10 seconds for graceful shutdown
    const timeout = setTimeout(() => {
      if (this.process && this.process.pid) {
        this.process.kill('SIGKILL');
      }
    }, 10000);

    try {
      await this.process;
    } catch {
      // Process may have been killed
    } finally {
      clearTimeout(timeout);
      this.process = null;
      this._pid = null;
      this.updateStatus('stopped');
    }
  }
}
