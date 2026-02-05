/**
 * Docker process runner
 */

import { execa } from 'execa';
import { ProcessRunner } from './base.js';

/**
 * Docker container runner
 */
export class DockerRunner extends ProcessRunner {
  private containerId: string | null = null;

  /**
   * Override parseOutputLine to capture container ID from Docker output
   */
  protected parseOutputLine(line: string, isStderr: boolean): void {
    // Docker run outputs container ID as first line (64-char hex string)
    if (!this.containerId && !isStderr && line.trim().match(/^[a-f0-9]{64}$/)) {
      this.containerId = line.trim();
    }
  }

  /**
   * Override stop for Docker-specific cleanup
   */
  async stop(): Promise<void> {
    // Stop and remove Docker container first
    if (this.containerId) {
      try {
        await execa('docker', ['stop', this.containerId], { timeout: 10000 });
      } catch {
        // If stop fails, force kill
        try {
          await execa('docker', ['kill', this.containerId]);
        } catch {
          // Container may already be stopped
        }
      }

      // Remove container
      try {
        await execa('docker', ['rm', this.containerId]);
      } catch {
        // Container may already be removed
      }

      this.containerId = null;
    }

    // Call parent stop to clean up process
    await super.stop();
  }
}
