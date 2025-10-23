/**
 * Bash process runner
 */

import { execa } from 'execa';
import { ProcessRunner } from './base.js';
import { getProcessEnv } from '../utils/system.js';

/**
 * Bash/script process runner
 */
export class BashRunner extends ProcessRunner {
  async start(): Promise<void> {
    if (this.process) {
      throw new Error(`Process ${this.name} is already running`);
    }

    this.updateStatus('starting');
    this.startTime = new Date();

    const cwd = this.config.cwd ?? process.cwd();
    const env = getProcessEnv(this.config.env);

    // If tmux is available, run in tmux pane
    if (this.tmuxManager) {
      await this.startInTmux(cwd, env);
    } else {
      await this.startDirectly(cwd, env);
    }
  }

  /**
   * Start process in tmux pane
   */
  private async startInTmux(cwd: string, _env: NodeJS.ProcessEnv): Promise<void> {
    const category = this.config.category ?? 'default';

    // Build command with only custom environment variables from config
    let command = this.config.command;
    const customEnv = this.config.env ?? {};
    if (Object.keys(customEnv).length > 0) {
      const envVars = Object.entries(customEnv)
        .map(([key, value]) => `export ${key}="${value}"`)
        .join(' && ');
      command = `${envVars} && ${command}`;
    }

    // Create tmux pane and run command
    this.paneId = await this.tmuxManager!.createProcessPane(category, this.name, command, cwd);

    // Mark as running
    this.updateStatus('running');
    this.emit('ready');
  }

  /**
   * Start process directly (without tmux)
   */
  private async startDirectly(cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    // Execute command
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

    // If exit-code ready check, wait for process to exit
    if (this.config.ready?.type === 'exit-code') {
      await this.process.catch(() => {
        // Process may fail
      });

      if (this.process.exitCode === 0) {
        this.updateStatus('running');
      } else {
        this.updateStatus('failed');
        throw new Error(`Process exited with code ${this.process.exitCode}`);
      }
    } else {
      // Process started successfully
      this.updateStatus('running');
    }
  }

  async stop(): Promise<void> {
    // If running in tmux, send Ctrl+C to pane
    if (this.paneId && this.tmuxManager) {
      await this.tmuxManager.sendKeys(this.paneId, 'C-c');
      this.paneId = null;
      this.updateStatus('stopped');
      return;
    }

    // Direct execution cleanup
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
