/**
 * Circular buffer implementation for storing process output lines
 *
 * Maintains a fixed-size buffer that wraps around when full,
 * preserving the most recent lines while discarding old ones.
 */

export interface OutputLine {
  content: string;       // Raw line content (preserves ANSI codes)
  timestamp: Date;
  processName: string;
  level: 'stdout' | 'stderr';
  lineNumber: number;    // Global line number (monotonically increasing)
}

export class CircularBuffer {
  private lines: OutputLine[] = [];
  private maxSize: number;
  private writeIndex: number = 0;
  private totalWritten: number = 0;
  private isFull: boolean = false;

  constructor(maxSize: number) {
    if (maxSize <= 0) {
      throw new Error('CircularBuffer maxSize must be greater than 0');
    }
    this.maxSize = maxSize;
  }

  /**
   * Append a line to the buffer
   */
  append(line: OutputLine): void {
    if (this.isFull) {
      // Overwrite oldest line
      this.lines[this.writeIndex] = line;
    } else {
      // Add new line
      this.lines.push(line);
    }

    this.writeIndex = (this.writeIndex + 1) % this.maxSize;
    this.totalWritten++;

    // Check if buffer is now full
    if (!this.isFull && this.lines.length === this.maxSize) {
      this.isFull = true;
    }
  }

  /**
   * Get all lines in chronological order (oldest to newest)
   */
  getAll(): OutputLine[] {
    if (!this.isFull) {
      // Buffer not full yet, return in insertion order
      return [...this.lines];
    }

    // Buffer is full, need to unwrap circular structure
    const result: OutputLine[] = [];
    for (let i = 0; i < this.maxSize; i++) {
      const index = (this.writeIndex + i) % this.maxSize;
      result.push(this.lines[index]);
    }
    return result;
  }

  /**
   * Get a slice of lines (start index is relative to oldest line)
   */
  getSlice(start: number, count: number): OutputLine[] {
    const all = this.getAll();
    return all.slice(start, start + count);
  }

  /**
   * Get the most recent N lines
   */
  getRecent(count: number): OutputLine[] {
    const all = this.getAll();
    return all.slice(Math.max(0, all.length - count));
  }

  /**
   * Clear all lines
   */
  clear(): void {
    this.lines = [];
    this.writeIndex = 0;
    this.totalWritten = 0;
    this.isFull = false;
  }

  /**
   * Get current number of lines in buffer
   */
  get length(): number {
    return this.lines.length;
  }

  /**
   * Get total number of lines written (including overwritten)
   */
  get totalLines(): number {
    return this.totalWritten;
  }

  /**
   * Get maximum buffer size
   */
  get size(): number {
    return this.maxSize;
  }

  /**
   * Check if buffer is full
   */
  get full(): boolean {
    return this.isFull;
  }
}
