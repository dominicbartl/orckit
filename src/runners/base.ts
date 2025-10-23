/**
 * Base class for process runners
 */

import { EventEmitter } from 'events';
import type { ProcessConfig, ProcessStatus, BuildInfo } from '../types/index.js';
import type { ResultPromise } from 'execa';
import type { TmuxManager } from '../core/tmux/manager.js';

/**
 * Base process runner
 */
export abstract class ProcessRunner extends EventEmitter {
  protected process: ResultPromise | null = null;
  protected _status: ProcessStatus = 'pending';
  protected _buildInfo: BuildInfo | null = null;
  protected startTime: Date | null = null;
  protected stopTime: Date | null = null;
  protected _restartCount = 0;
  protected _pid: number | null = null;
  protected paneId: string | null = null;

  constructor(
    protected name: string,
    protected config: ProcessConfig,
    protected tmuxManager?: TmuxManager
  ) {
    super();
  }

  /**
   * Start the process
   */
  abstract start(): Promise<void>;

  /**
   * Stop the process
   */
  abstract stop(): Promise<void>;

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
}
