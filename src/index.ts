/**
 * @orckit/cli - Process orchestration tool for local development
 *
 * Main export file for programmatic API
 */

// Core API
export { Orckit } from './core/orckit.js';

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
