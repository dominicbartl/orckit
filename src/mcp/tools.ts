import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Orckit } from '../orchestrator/orchestrator.js';
import type { ProcessState } from '../orchestrator/lifecycle.js';
import type { OrckitConfig } from '../config/schema.js';
import type { OutputLine } from '../process/output.js';

/**
 * Minimum surface the tool helpers need from an Orckit. The full `Orckit`
 * class naturally satisfies this; tests can pass a stub.
 */
export interface OrckitView {
  readonly config: OrckitConfig;
  inspect(name: string): {
    state: ProcessState;
    pid: number | null;
    startedAt: number | null;
    retries: number;
  };
  states(): Map<string, ProcessState>;
  output(name: string, n?: number): OutputLine[];
}

export interface StatusEntry {
  name: string;
  state: ProcessState;
  pid: number | null;
  startedAt: number | null;
  uptimeMs: number | null;
  retries: number;
  manualRetry: boolean;
}

export interface ErrorEntry {
  name: string;
  state: ProcessState;
  lastError: string | null;
  recentStderr: { timestamp: number; text: string }[];
}

export interface LogsResult {
  name: string;
  state: ProcessState;
  lines: { timestamp: number; stream: 'stdout' | 'stderr'; text: string }[];
}

const STATE_ICON: Record<ProcessState, string> = {
  pending: '·',
  starting: '◐',
  ready: '○',
  running: '✓',
  finished: '✓',
  stopping: '◑',
  stopped: '·',
  failed: '✗',
};

export function buildStatus(orckit: OrckitView): StatusEntry[] {
  const now = Date.now();
  const entries: StatusEntry[] = [];
  for (const [name, processConfig] of Object.entries(orckit.config.processes)) {
    const info = orckit.inspect(name);
    entries.push({
      name,
      state: info.state,
      pid: info.pid,
      startedAt: info.startedAt,
      uptimeMs: info.startedAt != null ? now - info.startedAt : null,
      retries: info.retries,
      manualRetry: processConfig.manual_retry,
    });
  }
  return entries;
}

export function buildErrors(orckit: OrckitView, lastErrors: Map<string, string>): ErrorEntry[] {
  const entries: ErrorEntry[] = [];
  for (const [name, state] of orckit.states()) {
    if (state !== 'failed') continue;
    const stderr = orckit
      .output(name)
      .filter((l) => l.stream === 'stderr')
      .slice(-50)
      .map((l) => ({ timestamp: l.timestamp, text: l.text }));
    entries.push({
      name,
      state,
      lastError: lastErrors.get(name) ?? null,
      recentStderr: stderr,
    });
  }
  return entries;
}

export function buildLogs(
  orckit: OrckitView,
  args: { name: string; lines?: number; stream?: 'stdout' | 'stderr' | 'all' },
): LogsResult {
  const lines = clamp(args.lines ?? 100, 1, 1000);
  const stream = args.stream ?? 'all';
  // inspect() throws "unknown process" before we touch the buffer, giving a
  // clean error path for callers (handled in registerTools below).
  const info = orckit.inspect(args.name);
  let raw = orckit.output(args.name);
  if (stream !== 'all') raw = raw.filter((l) => l.stream === stream);
  return {
    name: args.name,
    state: info.state,
    lines: raw.slice(-lines).map((l) => ({
      timestamp: l.timestamp,
      stream: l.stream,
      text: l.text,
    })),
  };
}

export function formatStatusText(entries: StatusEntry[]): string {
  if (entries.length === 0) return 'no processes configured';
  const nameW = Math.max(...entries.map((e) => e.name.length));
  const stateW = Math.max(...entries.map((e) => e.state.length));
  const lines: string[] = [];
  const counts: Partial<Record<ProcessState, number>> = {};
  for (const e of entries) {
    counts[e.state] = (counts[e.state] ?? 0) + 1;
    const pidPart = e.pid != null ? `pid ${e.pid}` : '';
    const upPart = e.uptimeMs != null ? `up ${formatDuration(e.uptimeMs)}` : '';
    const retryPart = e.retries > 0 ? `retries ${e.retries}` : '';
    const tail = [pidPart, upPart, retryPart].filter(Boolean).join('  ');
    lines.push(
      `  ${STATE_ICON[e.state]} ${e.name.padEnd(nameW)}  ${e.state.padEnd(stateW)}  ${tail}`,
    );
  }
  const summary = Object.entries(counts)
    .map(([s, n]) => `${n} ${s}`)
    .join(', ');
  return `${entries.length} processes (${summary}):\n${lines.join('\n')}`;
}

export function formatErrorsText(entries: ErrorEntry[]): string {
  if (entries.length === 0) return 'no errors — all processes are healthy';
  const blocks = entries.map((e) => {
    const head = `✗ ${e.name}  ${e.lastError ?? '(no error message captured)'}`;
    if (e.recentStderr.length === 0) {
      return `${head}\n  (no recent stderr)`;
    }
    const tail = e.recentStderr.map((l) => `  ! ${l.text}`).join('\n');
    return `${head}\n${tail}`;
  });
  return `${entries.length} failed process${entries.length === 1 ? '' : 'es'}:\n\n${blocks.join('\n\n')}`;
}

export function formatLogsText(result: LogsResult): string {
  const header = `${result.name} (${result.state}) — ${result.lines.length} line${result.lines.length === 1 ? '' : 's'}`;
  if (result.lines.length === 0) return `${header}\n  (no output captured)`;
  const body = result.lines
    .map((l) => `  ${l.stream === 'stderr' ? '!' : '|'} ${l.text}`)
    .join('\n');
  return `${header}\n${body}`;
}

const logsInputShape = {
  name: z.string().describe('Process name as defined in orckit.yaml.'),
  lines: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe('Number of most-recent lines to return (default 100, max 1000).'),
  stream: z
    .enum(['stdout', 'stderr', 'all'])
    .optional()
    .describe('Filter by stream (default "all").'),
};

export function registerTools(
  server: McpServer,
  orckit: Orckit,
  lastErrors: Map<string, string>,
): void {
  server.registerTool(
    'get_status',
    {
      title: 'Process status',
      description:
        'Get the current status of all processes managed by orckit for this project. ' +
        'Returns each process name, lifecycle state ' +
        '(pending/starting/ready/running/finished/stopping/stopped/failed), PID, uptime, ' +
        'retry count, and whether the process is marked manual_retry. Use this to answer ' +
        '"is the build running" or "what state is the API in".',
    },
    async () => {
      const entries = buildStatus(orckit);
      return toResult(formatStatusText(entries), { processes: entries });
    },
  );

  server.registerTool(
    'get_errors',
    {
      title: 'Failed processes',
      description:
        'List any failed processes with the failure error message and up to the last 50 ' +
        'lines of stderr. An empty list means everything is healthy. Use this first when ' +
        'diagnosing a broken build.',
    },
    async () => {
      const entries = buildErrors(orckit, lastErrors);
      return toResult(formatErrorsText(entries), { errors: entries });
    },
  );

  server.registerTool(
    'get_logs',
    {
      title: 'Process logs',
      description:
        'Get recent stdout/stderr from a named process. Use after get_errors to see more ' +
        'context around a failure, or to inspect output of a running process.',
      inputSchema: logsInputShape,
    },
    async (args) => {
      try {
        const result = buildLogs(orckit, args);
        return toResult(formatLogsText(result), result);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  );
}

function toResult(text: string, json: unknown): CallToolResult {
  return {
    content: [
      { type: 'text', text },
      { type: 'text', text: '```json\n' + JSON.stringify(json, null, 2) + '\n```' },
    ],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return `${m}m${remS}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}
