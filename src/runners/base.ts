/**
 * Base class for process runners
 */

import { EventEmitter } from 'events';
import { execa, type ResultPromise } from 'execa';
import type { ProcessConfig, ProcessStatus, BuildInfo } from '../types/index.js';
import { getProcessEnv } from '../utils/system.js';

/**
 * Base process runner - concrete implementation with hooks for subclasses
 */
export class ProcessRunner extends EventEmitter {
  protected process: ResultPromise | null = null;
  protected _status: ProcessStatus = 'pending';
  protected _buildInfo: BuildInfo | null = null;
  protected startTime: Date | null = null;
  protected stopTime: Date | null = null;
  protected _restartCount = 0;
  protected _pid: number | null = null;

  constructor(
    protected name: string,
    protected config: ProcessConfig
  ) {
    super();
  }

  /**
   * Start the process
   */
  async start(): Promise<void> {
    if (this.process) {
      throw new Error(`Process ${this.name} is already running`);
    }

    this.updateStatus('starting');
    this.startTime = new Date();

    const cwd = this.config.cwd ?? process.cwd();
    const env = getProcessEnv(this.config.env);

    // All process types use bash (Docker, Webpack are still bash commands)
    this.process = execa('bash', ['-c', this.config.command], {
      cwd,
      env,
      reject: false,
      all: true,
    });

    this._pid = this.process.pid ?? null;

    // Setup handlers
    this.setupStreamHandlers();
    this.setupExitHandler();

    // Handle exit-code ready check
    if (this.config.ready?.type === 'exit-code') {
      await this.waitForExitCode();
    } else {
      this.updateStatus('running');
    }
  }

  /**
   * Stop the process
   */
  async stop(): Promise<void> {
    if (!this.process || !this.process.pid) {
      return;
    }

    // Graceful shutdown: SIGTERM → wait 10s → SIGKILL
    this.process.kill('SIGTERM');

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

  /**
   * Restart the process
   */
  async restart(): Promise<void> {
    await this.stop();
    this._restartCount++;
    await this.start();
  }

  /**
   * Get current status
   */
  get status(): ProcessStatus {
    return this._status;
  }

  /**
   * Get process ID
   */
  get pid(): number | null {
    return this._pid;
  }

  /**
   * Get restart count
   */
  get restartCount(): number {
    return this._restartCount;
  }

  /**
   * Get build info (for build processes)
   */
  get buildInfo(): BuildInfo | null {
    return this._buildInfo;
  }

  /**
   * Get start time
   */
  get processStartTime(): Date | null {
    return this.startTime;
  }

  /**
   * Update status and emit event
   */
  protected updateStatus(status: ProcessStatus) {
    this._status = status;
    this.emit('status', status);
  }

  /**
   * Update build info and emit event
   */
  protected updateBuildInfo(buildInfo: Partial<BuildInfo>) {
    this._buildInfo = {
      ...this._buildInfo,
      ...buildInfo,
      errors: buildInfo.errors ?? this._buildInfo?.errors ?? 0,
      warnings: buildInfo.warnings ?? this._buildInfo?.warnings ?? 0,
    };
    this.emit('build:info', this._buildInfo);
  }

  /**
   * Setup stream handlers for stdout/stderr
   */
  private setupStreamHandlers(): void {
    this.process!.stdout?.on('data', (data: Buffer) => {
      const line = data.toString();
      this.emit('stdout', line);
      this.parseOutputLine(line, false);
    });

    this.process!.stderr?.on('data', (data: Buffer) => {
      const line = data.toString();
      this.emit('stderr', line);
      this.parseOutputLine(line, true);
    });
  }

  /**
   * Setup exit handler
   */
  private setupExitHandler(): void {
    void this.process!.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
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
  }

  /**
   * Wait for process to exit and check exit code
   */
  private async waitForExitCode(): Promise<void> {
    await this.process!.catch(() => {
      // Process may fail
    });

    if (this.process!.exitCode === 0) {
      this.updateStatus('running');
    } else {
      this.updateStatus('failed');
      throw new Error(`Process exited with code ${this.process!.exitCode}`);
    }
  }

  /**
   * Parse output line - hook for subclasses
   * Override this to parse build output, capture container IDs, etc.
   */
  protected parseOutputLine(_line: string, _isStderr: boolean): void {
    // Default: do nothing
    // Webpack/Angular/Docker override to parse build output
  }

  /**
   * Process output line (for external output feeding, e.g., from tmux)
   * Override in subclasses that need to parse output
   */
  processOutputLine(line: string, isStderr: boolean = false): void {
    // Emit as stdout/stderr so listeners can capture it
    if (isStderr) {
      this.emit('stderr', line);
    } else {
      this.emit('stdout', line);
    }

    // Parse the output
    this.parseOutputLine(line, isStderr);
  }
}
