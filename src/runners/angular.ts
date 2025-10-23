/**
 * Angular CLI runner with JSON output parsing
 */

import { execa } from 'execa';
import { ProcessRunner } from './base.js';
import { getProcessEnv } from '../utils/system.js';
import type { BuildInfo } from '../types/index.js';

/**
 * Angular build event from JSON output
 */
interface AngularBuildEvent {
  type: 'build-start' | 'build-progress' | 'build-complete' | 'build-error';
  progress?: number;
  message?: string;
  success?: boolean;
  time?: number;
  errors?: string[];
  warnings?: string[];
}

/**
 * Angular CLI runner
 */
export class AngularRunner extends ProcessRunner {
  async start(): Promise<void> {
    if (this.process) {
      throw new Error(`Process ${this.name} is already running`);
    }

    this.updateStatus('starting');
    this.startTime = new Date();

    const cwd = this.config.cwd ?? process.cwd();
    const env = getProcessEnv(this.config.env);

    // Modify command to add --json flag if not present
    let command = this.config.command;
    if (this.config.integration?.mode === 'deep' && !command.includes('--json')) {
      command += ' --progress=false';
    }

    // If tmux is available, run in tmux pane
    if (this.tmuxManager) {
      await this.startInTmux(command, cwd, env);
    } else {
      await this.startDirectly(command, cwd, env);
    }
  }

  /**
   * Start process in tmux pane
   */
  private async startInTmux(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    const category = this.config.category ?? 'default';

    // Build command with environment variables
    if (Object.keys(env).length > 0) {
      const envVars = Object.entries(env)
        .map(([key, value]) => `export ${key}="${value}"`)
        .join(' && ');
      command = `${envVars} && ${command}`;
    }

    // Create tmux pane and run command
    this.paneId = await this.tmuxManager!.createProcessPane(category, this.name, command, cwd);

    // Mark as running (in tmux mode, we can't parse output)
    this.updateStatus('building');
    this.emit('ready');
  }

  /**
   * Start process directly (without tmux)
   */
  private async startDirectly(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    // Execute Angular CLI command
    this.process = execa('bash', ['-c', command], {
      cwd,
      env,
      reject: false,
      all: true,
    });

    this._pid = this.process.pid ?? null;

    // Handle stdout - parse Angular output
    this.process.stdout?.on('data', (data: Buffer) => {
      const line = data.toString();
      this.emit('stdout', line);

      // Try to parse as JSON if deep integration
      if (this.config.integration?.mode === 'deep') {
        this.parseAngularJSON(line);
      } else {
        this.parseAngularText(line);
      }
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
   * Parse Angular JSON output
   */
  private parseAngularJSON(line: string): void {
    try {
      const event = JSON.parse(line) as AngularBuildEvent;

      switch (event.type) {
        case 'build-start':
          this.updateStatus('building');
          this.emit('build:start');
          break;

        case 'build-progress':
          if (event.progress !== undefined) {
            this.emit('build:progress', { progress: event.progress, message: event.message });
          }
          break;

        case 'build-complete':
          const buildInfo: BuildInfo = {
            duration: event.time ?? 0,
            errors: event.errors?.length ?? 0,
            warnings: event.warnings?.length ?? 0,
            lastBuildSuccess: event.success ?? false,
          };

          this.updateBuildInfo(buildInfo);
          this.updateStatus(event.success ? 'running' : 'failed');
          this.emit('build:complete', { buildInfo, duration: event.time ?? 0 });
          break;

        case 'build-error':
          this.updateStatus('failed');
          this.emit('build:failed');
          break;
      }
    } catch {
      // Not JSON, ignore
    }
  }

  /**
   * Parse Angular text output (fallback)
   */
  private parseAngularText(line: string): void {
    // Detect compilation start
    if (line.includes('Compiling') || line.includes('Building')) {
      this.updateStatus('building');
      this.emit('build:start');
    }

    // Parse progress
    const progressMatch = line.match(/(\d+)%/);
    if (progressMatch) {
      const progress = parseInt(progressMatch[1], 10);
      this.emit('build:progress', { progress });
    }

    // Detect successful build
    if (line.includes('Compiled successfully') || line.includes('Build complete')) {
      const buildInfo: BuildInfo = {
        errors: 0,
        warnings: 0,
        lastBuildSuccess: true,
      };

      this.updateBuildInfo(buildInfo);
      this.updateStatus('running');
      this.emit('build:complete', { buildInfo });
    }

    // Detect errors
    if (line.includes('ERROR') || line.includes('Failed to compile')) {
      this.updateStatus('failed');
      this.emit('build:failed');
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
