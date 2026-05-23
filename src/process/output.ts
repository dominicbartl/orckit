import type { OutputFilter } from '../config/schema.js';
import type { Stream } from './runner.js';

export interface OutputLine {
  text: string;
  stream: Stream;
  timestamp: number;
  highlight?: string;
}

export class OutputBuffer {
  private readonly entries: OutputLine[] = [];
  private readonly suppressRes: RegExp[];
  private readonly includeRes: RegExp[];
  private readonly highlightRes: { re: RegExp; color: string }[];

  constructor(
    public readonly capacity: number,
    filter?: OutputFilter,
  ) {
    this.suppressRes = (filter?.suppress ?? []).map((p) => new RegExp(p));
    this.includeRes = (filter?.include ?? []).map((p) => new RegExp(p));
    this.highlightRes = (filter?.highlight ?? []).map((h) => ({
      re: new RegExp(h.pattern),
      color: h.color,
    }));
  }

  push(text: string, stream: Stream): OutputLine | null {
    if (this.suppressRes.some((re) => re.test(text))) return null;
    if (this.includeRes.length > 0 && !this.includeRes.some((re) => re.test(text))) return null;

    const highlight = this.highlightRes.find((h) => h.re.test(text))?.color;
    const line: OutputLine = { text, stream, timestamp: Date.now(), highlight };
    this.entries.push(line);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
    return line;
  }

  size(): number {
    return this.entries.length;
  }

  recent(n = this.entries.length): OutputLine[] {
    return this.entries.slice(-n);
  }

  clear(): void {
    this.entries.length = 0;
  }
}
