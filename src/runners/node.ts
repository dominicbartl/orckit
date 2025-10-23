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

    // Use node or ts-node based on type
    const runtime = this.config.type === 'ts-node' ? 'ts-node' : 'node';

    // If tmux is available, run in tmux pane
    if (this.tmuxManager) {
      await this.startInTmux(runtime, cwd, env);
    } else {
      await this.startDirectly(runtime, cwd, env);
    }
  }

  /**
   * Start process in tmux pane
   */
  private async startInTmux(
    runtime: string,
    cwd: string,
    env: NodeJS.ProcessEnv
  ): Promise<void> {
    const category = this.config.category ?? 'default';

    // Build command with environment variables
    let command = `${runtime} -e "${this.config.command.replace(/"/g, '\\"')}"`;
    if (Object.keys(env).length > 0) {
      const envVars = Object.entries(env)
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
  private async startDirectly(
    runtime: string,
    cwd: string,
    env: NodeJS.ProcessEnv
  ): Promise<void> {
    // Execute command
    this.process = execa(runtime, ['-e', this.config.command], {
      cwd,
      env,
      reject: false,
      all: true,
      shell: true,
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
