/**
 * Node.js and TypeScript process runner
 */

import { execa } from 'execa';
import { ProcessRunner } from './base.js';
import { getProcessEnv } from '../utils/system.js';

/**
 * Node.js process runner
 */
export class NodeRunner extends ProcessRunner {
  async start(): Promise<void> {
    if (this.process) {
      throw new Error(`Process ${this.name} is already running`);
    }

    this.updateStatus('starting');
    this.startTime = new Date();

    const cwd = this.config.cwd ?? process.cwd();
    const env = getProcessEnv(this.config.env);

    // Execute command as shell command
    // Note: Node type is for Node.js projects, not for running JS code with -e
    this.process = execa('bash', ['-c', this.config.command], {
      cwd,
      env,
      reject: false,
      all: true,
    });

    this._pid = this.process.pid ?? null;

    // Handle stdout
    this.process.stdout?.on('data', (data: Buffer) => {
      const line = data.toString();
      this.emit('stdout', line);
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
    this.updateStatus('running');
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
