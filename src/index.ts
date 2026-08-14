export { Orckit, BootFailedError, StartupAbortedError } from './orchestrator/orchestrator.js';
export type { OrckitEvents, BootSummary, RestartOptions } from './orchestrator/orchestrator.js';

export {
  type ProcessState,
  type LifecycleEvent,
  transition,
  isActive,
  isTerminal,
  isReadyOrDone,
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
  LogsConfig,
  McpConfig,
  WebConfig,
  IdeConfig,
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
export {
  isPortFree,
  findPortHolders,
  describePortHolders,
  freePort,
  killPortHolders,
  type PortHolderInfo,
} from './util/port.js';
export {
  collectExpectedPorts,
  findBlockedPorts,
  isContainerProxy,
  type ExpectedPort,
  type BlockedPort,
} from './util/blocked-ports.js';

export {
  attachCliReporter,
  renderStatus,
  type CliReporterOptions,
} from './reporter/cli-reporter.js';
export {
  attachLogReporter,
  type LogReporterOptions,
  type LogReporterHandle,
} from './reporter/log-reporter.js';
export { renderGraph, type RenderGraphOptions } from './reporter/graph-view.js';
export {
  attachSessionTracker,
  type SessionTrackerOptions,
  type SessionTrackerHandle,
} from './reporter/session-tracker.js';
export {
  readSession,
  writeSession,
  clearSession,
  findSurvivors,
  killSurvivor,
  survivorSize,
  commandsMatch,
  isAlive,
  sessionFilePath,
  type SessionRecord,
  type SessionFile,
} from './util/session-state.js';
export {
  collectProcessTree,
  collectProcessTreeSync,
  snapshotAll,
  treeFrom,
  detailedTreeFrom,
  mergeTrees,
  signalTree,
  survivors,
  type ProcessTree,
  type PsRow,
} from './util/process-tree.js';
export {
  attachDashboard,
  type DashboardOptions,
  type DashboardHandle,
} from './reporter/dashboard.js';

export { attachMcpServer, type McpServerOptions, type McpServerHandle } from './mcp/server.js';
export { attachWebUi, type WebUiServerOptions, type WebUiServerHandle } from './web/server.js';
export { detectIde, type IdeLink, type DetectIdeOptions } from './web/ide.js';
