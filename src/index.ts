export { Orckit, BootFailedError } from './orchestrator/orchestrator.js';
export type { OrckitEvents, BootSummary, RestartOptions } from './orchestrator/orchestrator.js';

export {
  type ProcessState,
  type LifecycleEvent,
  transition,
  isActive,
  isTerminal,
} from './orchestrator/lifecycle.js';

export { loadConfig, parseConfigText, validateConfig, ConfigError } from './config/load.js';

export type {
  OrckitConfig,
  ProcessConfig,
  ProcessType,
  ReadyCheck,
  HttpReadyCheck,
  TcpReadyCheck,
  LogPatternReadyCheck,
  ExitCodeReadyCheck,
  CustomReadyCheck,
  HookConfig,
  OutputFilter,
  RestartPolicy,
  PreflightCheck,
} from './config/schema.js';

export {
  buildGraph,
  resolveStartOrder,
  groupIntoWaves,
  transitiveDependencies,
  filterToTargets,
  visualize,
  DependencyError,
} from './graph/resolver.js';

export type { DependencyGraph } from './graph/resolver.js';

export { createProbe, type HealthProbe, type ProbeResult } from './health/checks.js';
export { waitForReady, HealthTimeoutError } from './health/wait.js';

export { Runner, type Stream, type RunnerEvents } from './process/runner.js';
export {
  type BuildEvent,
  type LineParser,
  parseWebpackLine,
  parseAngularLine,
  getParser,
  stripAnsi,
} from './process/parsers.js';
export { OutputBuffer, type OutputLine } from './process/output.js';

export { runHook, HookError, type HookKind, type HookContext } from './orchestrator/hooks.js';
export { runPreflight, PreflightError, type PreflightResult } from './orchestrator/preflight.js';

export { parseDuration, formatDuration } from './config/duration.js';
export { isPortFree } from './util/port.js';

export {
  attachCliReporter,
  renderStatus,
  type CliReporterOptions,
} from './reporter/cli-reporter.js';
