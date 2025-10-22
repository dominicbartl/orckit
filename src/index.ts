/**
 * @orckit/cli - Process orchestration tool for local development
 *
 * Main export file for programmatic API
 */

// Core API
export { Orckit } from './core/orckit.js';
export { Orchestrator } from './core/orchestrator.js';

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
