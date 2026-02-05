/**
 * Output Buffer Manager
 *
 * Manages circular buffers for all process outputs,
 * replacing the tmux named pipe approach with in-memory buffering.
 */

import { CircularBuffer, type OutputLine } from './circular-buffer.js';

export interface BufferManagerOptions {
  defaultBufferSize?: number;
}

export interface BufferStats {
  currentLines: number;
  totalLines: number;
  maxSize: number;
  isFull: boolean;
}

/**
 * Manages output buffers for all processes
 */
export class OutputBufferManager {
  private buffers: Map<string, CircularBuffer> = new Map();
  private defaultBufferSize: number;

  constructor(options: BufferManagerOptions = {}) {
    this.defaultBufferSize = options.defaultBufferSize ?? 10000;
  }

  /**
   * Create a buffer for a process
   */
  createBuffer(processName: string, size?: number): void {
    const bufferSize = size ?? this.defaultBufferSize;
    const buffer = new CircularBuffer(bufferSize);
    this.buffers.set(processName, buffer);
  }

  /**
   * Append a line to a process buffer
   */
  appendLine(
    processName: string,
    content: string,
    level: 'stdout' | 'stderr'
  ): void {
    const buffer = this.buffers.get(processName);
    if (!buffer) {
      // Auto-create buffer if it doesn't exist
      this.createBuffer(processName);
      return this.appendLine(processName, content, level);
    }

    // Split content by newlines (in case multiple lines arrive)
    const lines = content.split('\n');

    for (const line of lines) {
      // Skip empty lines and whitespace-only lines
      if (line.trim() === '') continue;

      const outputLine: OutputLine = {
        content: line,
        timestamp: new Date(),
        processName,
        level,
        lineNumber: buffer.totalLines + 1,
      };

      buffer.append(outputLine);
    }
  }

  /**
   * Get all lines from a process buffer
   */
  getBuffer(processName: string): OutputLine[] {
    const buffer = this.buffers.get(processName);
    if (!buffer) {
      return [];
    }
    return buffer.getAll();
  }

  /**
   * Get a slice of lines from a process buffer
   */
  getBufferSlice(processName: string, start: number, count: number): OutputLine[] {
    const buffer = this.buffers.get(processName);
    if (!buffer) {
      return [];
    }
    return buffer.getSlice(start, count);
  }

  /**
   * Get the most recent N lines from a process buffer
   */
  getRecent(processName: string, count: number): OutputLine[] {
    const buffer = this.buffers.get(processName);
    if (!buffer) {
      return [];
    }
    return buffer.getRecent(count);
  }

  /**
   * Clear a process buffer
   */
  clearBuffer(processName: string): void {
    const buffer = this.buffers.get(processName);
    if (buffer) {
      buffer.clear();
    }
  }

  /**
   * Get buffer statistics for a process
   */
  getBufferStats(processName: string): BufferStats | null {
    const buffer = this.buffers.get(processName);
    if (!buffer) {
      return null;
    }

    return {
      currentLines: buffer.length,
      totalLines: buffer.totalLines,
      maxSize: buffer.size,
      isFull: buffer.full,
    };
  }

  /**
   * Check if a process has a buffer
   */
  hasBuffer(processName: string): boolean {
    return this.buffers.has(processName);
  }

  /**
   * Get all process names with buffers
   */
  getProcessNames(): string[] {
    return Array.from(this.buffers.keys());
  }

  /**
   * Remove a process buffer
   */
  removeBuffer(processName: string): void {
    this.buffers.delete(processName);
  }

  /**
   * Cleanup all buffers
   */
  cleanup(): void {
    this.buffers.clear();
  }

  /**
   * Get total number of buffers
   */
  get bufferCount(): number {
    return this.buffers.size;
  }
}
