/**
 * @orckit/cli - Process orchestration tool for local development
 *
 * Main export file for programmatic API
 */

// Core API - Orckit is the main orchestrator class
export { Orckit } from './core/orckit.js';
export type { OrckitOptions, OrckitEvents } from './core/orckit.js';

// Managers - for advanced use cases and testing
export { ConfigManager } from './core/config/manager.js';
export type { ConfigManagerOptions, DependencyInfo } from './core/config/manager.js';

export { ProcessManager } from './core/process/manager.js';
export type { ProcessManagerOptions, ProcessManagerEvents } from './core/process/manager.js';


// Status monitoring
export { StatusMonitor, formatStatusSnapshot, formatCompactStatus } from './core/status/index.js';
export type {
  ProcessResourceUsage,
  BuildMetrics,
  ProcessStatusInfo,
  StatusSnapshot,
  StatusMonitorOptions,
} from './core/status/index.js';

// Types
export type {
  OrckitConfig,
  ProcessConfig,
  ProcessStatus,
  ProcessDisplayInfo,
  BuildInfo,
  ReadyCheck,
  HttpReadyCheck,
  TcpReadyCheck,
  ExitCodeReadyCheck,
  LogPatternReadyCheck,
  CustomReadyCheck,
  ProcessHooks,
  OutputConfig,
  OrckitEventType,
  ProcessEvent,
  ProcessStartingEvent,
  ProcessReadyEvent,
  ProcessFailedEvent,
  BuildProgressEvent,
  BuildCompleteEvent,
} from './types/index.js';
