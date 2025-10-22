/**
 * Vite process runner
 */

import { execa } from 'execa';
import { ProcessRunner } from './base.js';
import { getProcessEnv } from '../utils/system.js';

/**
 * Vite dev server runner
 */
export class ViteRunner extends ProcessRunner {
  async start(): Promise<void> {
    if (this.process) {
      throw new Error(`Process ${this.name} is already running`);
    }

    this.updateStatus('starting');
    this.startTime = new Date();

    const cwd = this.config.cwd ?? process.cwd();
    const env = getProcessEnv(this.config.env);

    // Execute Vite command
    this.process = execa('bash', ['-c', this.config.command], {
      cwd,
      env,
      reject: false,
      all: true,
    });

    this._pid = this.process.pid ?? null;

    // Handle stdout - parse Vite output
    this.process.stdout?.on('data', (data: Buffer) => {
      const line = data.toString();
      this.emit('stdout', line);

      // Parse Vite output
      this.parseViteOutput(line);
    });

    // Handle stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      const line = data.toString();
      this.emit('stderr', line);
    });

    // Handle exit
    void this.process.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
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
   * Parse Vite output for build information
   */
  private parseViteOutput(line: string): void {
    // Detect dev server ready
    if (line.includes('Local:') || line.includes('ready in')) {
      this.updateStatus('running');

      // Extract build time
      const timeMatch = line.match(/ready in (\d+)\s*ms/);
      if (timeMatch) {
        const duration = parseInt(timeMatch[1], 10);
        this.updateBuildInfo({
          duration,
          errors: 0,
          warnings: 0,
          lastBuildSuccess: true,
        });
        this.emit('build:complete', { duration });
      }
    }

    // Detect rebuilding
    if (line.includes('page reload') || line.includes('hmr update')) {
      this.updateStatus('building');
      this.emit('build:start');
    }

    // Detect errors
    if (line.includes('ERROR') || line.includes('error')) {
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
