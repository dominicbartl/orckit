/**
 * Logging utilities for Orckit
 */

import chalk from 'chalk';
import dayjs from 'dayjs';
import type { OutputConfig } from '../types/index.js';

/**
 * Debug logging levels
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

/**
 * Global debug logger configuration
 */
class DebugLoggerConfig {
  private level: LogLevel = LogLevel.INFO;
  private enabled = false;

  setLevel(level: LogLevel) {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  shouldLog(level: LogLevel): boolean {
    return this.enabled && level >= this.level;
  }
}

export const debugConfig = new DebugLoggerConfig();

/**
 * Initialize debug logging from environment or config
 */
export function initializeDebugLogging() {
  const debugEnv = process.env.ORCKIT_DEBUG || process.env.DEBUG;

  if (debugEnv) {
    debugConfig.setEnabled(true);

    // Parse debug level from environment
    const levelStr = (process.env.ORCKIT_LOG_LEVEL || '').toUpperCase();
    switch (levelStr) {
      case 'DEBUG':
        debugConfig.setLevel(LogLevel.DEBUG);
        break;
      case 'INFO':
        debugConfig.setLevel(LogLevel.INFO);
        break;
      case 'WARN':
        debugConfig.setLevel(LogLevel.WARN);
        break;
      case 'ERROR':
        debugConfig.setLevel(LogLevel.ERROR);
        break;
      default:
        debugConfig.setLevel(LogLevel.DEBUG);
    }
  }
}

/**
 * Debug logger for internal operations
 */
export class DebugLogger {
  constructor(private component: string) {}

  private formatMessage(level: string, message: string, ...args: unknown[]): string {
    const timestamp = dayjs().format('HH:mm:ss.SSS');
    const levelColor = this.getLevelColor(level);
    const componentColor = chalk.cyan;

    let msg = `${chalk.gray(`[${timestamp}]`)} ${levelColor(`[${level}]`)} ${componentColor(`[${this.component}]`)} ${message}`;

    if (args.length > 0) {
      const formattedArgs = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');
      msg += ` ${chalk.gray(formattedArgs)}`;
    }

    return msg;
  }

  private getLevelColor(level: string): (str: string) => string {
    switch (level) {
      case 'DEBUG':
        return chalk.blue;
      case 'INFO':
        return chalk.green;
      case 'WARN':
        return chalk.yellow;
      case 'ERROR':
        return chalk.red;
      default:
        return chalk.white;
    }
  }

  debug(message: string, ...args: unknown[]) {
    if (debugConfig.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage('DEBUG', message, ...args));
    }
  }

  info(message: string, ...args: unknown[]) {
    if (debugConfig.shouldLog(LogLevel.INFO)) {
      console.log(this.formatMessage('INFO', message, ...args));
    }
  }

  warn(message: string, ...args: unknown[]) {
    if (debugConfig.shouldLog(LogLevel.WARN)) {
      console.log(this.formatMessage('WARN', message, ...args));
    }
  }

  error(message: string, ...args: unknown[]) {
    if (debugConfig.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage('ERROR', message, ...args));
    }
  }

  /**
   * Log with timing information
   */
  time(label: string): () => void {
    const start = Date.now();
    this.debug(`⏱️  ${label} started`);

    return () => {
      const duration = Date.now() - start;
      this.debug(`⏱️  ${label} completed in ${formatDuration(duration)}`);
    };
  }

  /**
   * Log a group of related operations
   */
  group(label: string, fn: () => void | Promise<void>): void | Promise<void> {
    this.debug(`📂 ${label}`);
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(() => this.debug(`📂 ${label} ✓`));
    }
    this.debug(`📂 ${label} ✓`);
  }
}

/**
 * Create a debug logger for a component
 */
export function createDebugLogger(component: string): DebugLogger {
  return new DebugLogger(component);
}

/**
 * Process-specific logger with filtering and formatting
 */
export class ProcessLogger {
  private lineBuffer: string[] = [];
  private maxLines: number;

  constructor(
    private processName: string,
    private config: OutputConfig = {},
    private color: string = '#89b4fa'
  ) {
    this.maxLines = config.format?.max_lines ?? 1000;
  }

  /**
   * Format a log line with filters and formatting
   *
   * @param line - Raw log line
   * @returns Formatted line or null if suppressed
   */
  formatLine(line: string): string | null {
    // Apply suppression filters
    if (this.shouldSuppress(line)) {
      return null;
    }

    // Check include patterns (whitelist mode)
    if (this.config.filter?.include_patterns && this.config.filter.include_patterns.length > 0) {
      if (!this.shouldInclude(line)) {
        return null;
      }
    }

    // Build formatted output
    let output = '';

    // Timestamp
    if (this.config.format?.timestamp) {
      output += chalk.gray(`[${dayjs().format('HH:mm:ss.SSS')}] `);
    }

    // Process prefix with color
    const prefix = this.config.format?.prefix ?? this.processName;
    output += chalk.hex(this.color).bold(`[${prefix}] `);

    // Apply highlighting
    const formattedLine = this.applyHighlighting(line);

    output += formattedLine;

    // Add to buffer
    this.lineBuffer.push(output);
    if (this.lineBuffer.length > this.maxLines) {
      this.lineBuffer.shift();
    }

    return output;
  }

  /**
   * Check if a line should be suppressed
   */
  private shouldSuppress(line: string): boolean {
    const patterns = this.config.filter?.suppress_patterns ?? [];
    return patterns.some((pattern) => new RegExp(pattern).test(line));
  }

  /**
   * Check if a line should be included (whitelist mode)
   */
  private shouldInclude(line: string): boolean {
    const patterns = this.config.filter?.include_patterns ?? [];
    return patterns.some((pattern) => new RegExp(pattern).test(line));
  }

  /**
   * Apply highlighting patterns to a line
   */
  private applyHighlighting(line: string): string {
    const highlights = this.config.filter?.highlight_patterns ?? [];

    for (const { pattern, color } of highlights) {
      const regex = new RegExp(`(${pattern})`, 'gi');
      line = line.replace(regex, (match) => {
        // Map color names to chalk colors
        const chalkColor = this.getChalkColor(color);
        return chalkColor(match);
      });
    }

    return line;
  }

  /**
   * Get chalk color function from color name
   */
  private getChalkColor(colorName: string): (str: string) => string {
    const colorMap: Record<string, (str: string) => string> = {
      red: chalk.red,
      green: chalk.green,
      yellow: chalk.yellow,
      blue: chalk.blue,
      magenta: chalk.magenta,
      cyan: chalk.cyan,
      white: chalk.white,
      gray: chalk.gray,
      grey: chalk.gray,
      black: chalk.black,
      bold: chalk.bold,
    };

    return colorMap[colorName.toLowerCase()] ?? chalk.white;
  }

  /**
   * Get buffered lines
   */
  getBuffer(): string[] {
    return [...this.lineBuffer];
  }

  /**
   * Clear the buffer
   */
  clearBuffer() {
    this.lineBuffer = [];
  }
}

/**
 * Get a consistent color for a process name
 * Uses a hash of the name to pick from a predefined palette
 */
export function getProcessColor(processName: string): string {
  const colors = [
    '#89b4fa', // Blue
    '#a6e3a1', // Green
    '#f9e2af', // Yellow
    '#fab387', // Orange
    '#f38ba8', // Red
    '#cba6f7', // Purple
    '#94e2d5', // Teal
    '#f5c2e7', // Pink
    '#b4befe', // Lavender
    '#74c7ec', // Sky
  ];

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < processName.length; i++) {
    hash = (hash << 5) - hash + processName.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }

  return colors[Math.abs(hash) % colors.length];
}

/**
 * Format a duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    if (remainingSeconds === 0) {
      return `${minutes}m`;
    }
    return `${minutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format uptime
 */
export function formatUptime(startTime: Date): string {
  const now = new Date();
  const diff = now.getTime() - startTime.getTime();
  return formatDuration(diff);
}

/**
 * Format file size
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }

  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)}KB`;
  }

  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb.toFixed(1)}MB`;
  }

  const gb = mb / 1024;
  return `${gb.toFixed(1)}GB`;
}

/**
 * Create a progress bar
 */
export function createProgressBar(progress: number, width: number = 20): string {
  const filled = Math.floor((progress / 100) * width);
  const empty = width - filled;

  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Status icon helpers
 */
export const StatusIcons = {
  pending: '⏳',
  starting: '⚙',
  running: '✓',
  building: '⚙',
  failed: '✗',
  stopped: '⏸',
} as const;

/**
 * Get colored status icon
 */
export function getStatusIcon(
  status: 'pending' | 'starting' | 'running' | 'building' | 'failed' | 'stopped'
): string {
  const icon = StatusIcons[status];

  switch (status) {
    case 'running':
      return chalk.green(icon);
    case 'failed':
      return chalk.red(icon);
    case 'building':
    case 'starting':
      return chalk.yellow(icon);
    case 'stopped':
      return chalk.gray(icon);
    default:
      return icon;
  }
}
