/**
 * Docker process runner
 */

import { execa } from 'execa';
import { ProcessRunner } from './base.js';
import { getProcessEnv } from '../utils/system.js';

/**
 * Docker container runner
 */
export class DockerRunner extends ProcessRunner {
  private containerId: string | null = null;

  async start(): Promise<void> {
    if (this.process) {
      throw new Error(`Process ${this.name} is already running`);
    }

    this.updateStatus('starting');
    this.startTime = new Date();

    const cwd = this.config.cwd ?? process.cwd();
    const env = getProcessEnv(this.config.env);

    // Execute Docker command
    this.process = execa('bash', ['-c', this.config.command], {
      cwd,
      env,
      reject: false,
      all: true,
    });

    this._pid = this.process.pid ?? null;

    // Capture container ID from output
    this.process.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim();

      // Docker run outputs container ID as first line
      if (!this.containerId && line.match(/^[a-f0-9]{64}$/)) {
        this.containerId = line;
      }

      this.emit('stdout', line);
    });

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
    this.updateStatus('running');
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    // Stop Docker container gracefully
    if (this.containerId) {
      try {
        await execa('docker', ['stop', this.containerId], { timeout: 10000 });
      } catch {
        // If stop fails, try to kill
        try {
          await execa('docker', ['kill', this.containerId]);
        } catch {
          // Container may already be stopped
        }
      }

      // Clean up container
      try {
        await execa('docker', ['rm', this.containerId]);
      } catch {
        // Container may already be removed
      }

      this.containerId = null;
    }

    // Kill the process
    if (this.process.pid) {
      this.process.kill('SIGTERM');
    }

    try {
      await this.process;
    } catch {
      // Process may have been killed
    } finally {
      this.process = null;
      this._pid = null;
      this.updateStatus('stopped');
    }
  }
}
