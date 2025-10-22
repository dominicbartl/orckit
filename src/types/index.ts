/**
 * Core type definitions for Orckit
 */

/**
 * Process status enum
 */
export type ProcessStatus = 'pending' | 'starting' | 'running' | 'building' | 'failed' | 'stopped';

/**
 * Restart policy for processes
 */
export type RestartPolicy = 'always' | 'on-failure' | 'never';

/**
 * Ready check types
 */
export type ReadyCheckType = 'http' | 'tcp' | 'exit-code' | 'log-pattern' | 'custom';

/**
 * Process types
 */
export type ProcessType =
  | 'bash'
  | 'docker'
  | 'node'
  | 'ts-node'
  | 'webpack'
  | 'angular'
  | 'vite'
  | 'build';

/**
 * Boot logger styles
 */
export type BootLoggerStyle = 'timeline' | 'dashboard' | 'minimal' | 'quiet';

/**
 * HTTP ready check configuration
 */
export interface HttpReadyCheck {
  type: 'http';
  url: string;
  timeout?: number; // milliseconds
  expectedStatus?: number;
  interval?: number; // milliseconds between attempts
  maxAttempts?: number;
}

/**
 * TCP ready check configuration
 */
export interface TcpReadyCheck {
  type: 'tcp';
  host: string;
  port: number;
  timeout?: number;
  interval?: number;
  maxAttempts?: number;
}

/**
 * Exit code ready check configuration
 */
export interface ExitCodeReadyCheck {
  type: 'exit-code';
  timeout?: number;
}

/**
 * Log pattern ready check configuration
 */
export interface LogPatternReadyCheck {
  type: 'log-pattern';
  pattern: string; // regex pattern
  timeout?: number;
}

/**
 * Custom ready check configuration
 */
export interface CustomReadyCheck {
  type: 'custom';
  command: string;
  timeout?: number;
  interval?: number;
  maxAttempts?: number;
}

/**
 * Union type for all ready check configurations
 */
export type ReadyCheck =
  | HttpReadyCheck
  | TcpReadyCheck
  | ExitCodeReadyCheck
  | LogPatternReadyCheck
  | CustomReadyCheck;

/**
 * Output filtering configuration
 */
export interface OutputFilterConfig {
  suppress_patterns?: string[];
  highlight_patterns?: Array<{
    pattern: string;
    color: string;
  }>;
  include_patterns?: string[];
}

/**
 * Output format configuration
 */
export interface OutputFormatConfig {
  timestamp?: boolean;
  prefix?: string;
  max_lines?: number;
}

/**
 * Output configuration
 */
export interface OutputConfig {
  filter?: OutputFilterConfig;
  format?: OutputFormatConfig;
}

/**
 * Process hooks configuration
 */
export interface ProcessHooks {
  pre_start?: string;
  post_start?: string;
  pre_stop?: string;
  post_stop?: string;
}

/**
 * Build integration configuration
 */
export interface BuildIntegration {
  mode?: 'deep' | 'logs-only';
}

/**
 * Process configuration
 */
export interface ProcessConfig {
  category: string;
  type?: ProcessType;
  command: string;
  cwd?: string;
  dependencies?: string[];
  restart?: RestartPolicy;
  restart_delay?: string; // e.g., "5s", "1m"
  max_retries?: number;
  env?: Record<string, string>;
  ready?: ReadyCheck;
  output?: OutputConfig;
  hooks?: ProcessHooks;
  integration?: BuildIntegration;
  config?: string; // Path to config file (for webpack, etc.)
  preflight?: string[]; // Custom preflight checks
}

/**
 * Category configuration
 */
export interface CategoryConfig {
  window: string;
}

/**
 * Global hooks configuration
 */
export interface GlobalHooks {
  pre_start_all?: string;
  post_start_all?: string;
  pre_stop_all?: string;
  post_stop_all?: string;
}

/**
 * Preflight check configuration
 */
export interface PreflightCheckConfig {
  name: string;
  command: string;
  error: string;
  fix?: string;
}

/**
 * Preflight configuration
 */
export interface PreflightConfig {
  checks?: PreflightCheckConfig[];
}

/**
 * Boot configuration
 */
export interface BootConfig {
  style?: BootLoggerStyle;
  show_preflight?: boolean;
  show_graph?: boolean;
  show_progress_bars?: boolean;
  show_hooks?: boolean;
  show_timing?: boolean;
  collapse_successful?: boolean;
}

/**
 * Maestro main configuration
 */
export interface MaestroConfig {
  boot?: BootConfig;
}

/**
 * Complete Orckit configuration
 */
export interface OrckitConfig {
  version?: string;
  project?: string;
  categories?: Record<string, CategoryConfig>;
  processes: Record<string, ProcessConfig>;
  hooks?: GlobalHooks;
  preflight?: PreflightConfig;
  maestro?: MaestroConfig;
}

/**
 * Build information for monitoring
 */
export interface BuildInfo {
  progress?: number; // 0-100
  duration?: number; // milliseconds
  errors: number;
  warnings: number;
  modules?: { current: number; total: number };
  chunks?: number;
  size?: string;
  sizeDiff?: string;
  lastBuildSuccess?: boolean;
  hash?: string;
}

/**
 * Process display information
 */
export interface ProcessDisplayInfo {
  name: string;
  status: ProcessStatus;
  icon: string;
  uptime?: string;
  restarts: number;
  cpu?: number;
  memory?: string;
  ports?: number[];
  urls?: string[];
  buildInfo?: BuildInfo;
  lastError?: string;
}

/**
 * Process runtime information
 */
export interface ProcessRuntimeInfo {
  pid?: number;
  startedAt?: Date;
  stoppedAt?: Date;
  restartCount: number;
  status: ProcessStatus;
  exitCode?: number;
  signal?: string;
}

/**
 * Preflight check result
 */
export interface PreflightCheckResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  fixSuggestion?: string;
}

/**
 * Event types for programmatic API
 */
export type OrckitEventType =
  | 'process:starting'
  | 'process:ready'
  | 'process:running'
  | 'process:failed'
  | 'process:stopped'
  | 'process:restarting'
  | 'build:start'
  | 'build:progress'
  | 'build:complete'
  | 'build:failed'
  | 'hook:start'
  | 'hook:complete'
  | 'preflight:start'
  | 'preflight:complete'
  | 'all:ready';

/**
 * Event data types
 */
export interface ProcessEvent {
  processName: string;
  timestamp: Date;
}

export interface ProcessStartingEvent extends ProcessEvent {
  config: ProcessConfig;
}

export interface ProcessReadyEvent extends ProcessEvent {
  duration: number;
}

export interface ProcessFailedEvent extends ProcessEvent {
  error: Error;
  exitCode?: number;
}

export interface BuildProgressEvent extends ProcessEvent {
  progress: number;
  message?: string;
}

export interface BuildCompleteEvent extends ProcessEvent {
  duration: number;
  buildInfo: BuildInfo;
}

/**
 * Type guard utilities
 */
export function isHttpReadyCheck(check: ReadyCheck): check is HttpReadyCheck {
  return check.type === 'http';
}

export function isTcpReadyCheck(check: ReadyCheck): check is TcpReadyCheck {
  return check.type === 'tcp';
}

export function isLogPatternReadyCheck(check: ReadyCheck): check is LogPatternReadyCheck {
  return check.type === 'log-pattern';
}
