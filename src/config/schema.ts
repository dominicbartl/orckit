import { z } from 'zod';

const httpReadyCheck = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  expected_status: z.number().int().min(100).max(599).default(200),
  interval_ms: z.number().int().positive().default(1000),
  timeout_ms: z.number().int().positive().default(60_000),
});

const tcpReadyCheck = z.object({
  type: z.literal('tcp'),
  host: z.string().default('localhost'),
  port: z.number().int().min(1).max(65_535),
  interval_ms: z.number().int().positive().default(1000),
  timeout_ms: z.number().int().positive().default(60_000),
});

const logPatternReadyCheck = z.object({
  type: z.literal('log-pattern'),
  pattern: z.string().min(1),
  timeout_ms: z.number().int().positive().default(60_000),
});

const exitCodeReadyCheck = z.object({
  type: z.literal('exit-code'),
  timeout_ms: z.number().int().positive().default(60_000),
});

const customReadyCheck = z.object({
  type: z.literal('custom'),
  command: z.string().min(1),
  interval_ms: z.number().int().positive().default(1000),
  timeout_ms: z.number().int().positive().default(60_000),
});

export const readyCheckSchema = z.discriminatedUnion('type', [
  httpReadyCheck,
  tcpReadyCheck,
  logPatternReadyCheck,
  exitCodeReadyCheck,
  customReadyCheck,
]);

const outputFilterSchema = z.object({
  suppress: z.array(z.string()).default([]),
  highlight: z
    .array(
      z.object({
        pattern: z.string(),
        color: z.enum(['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'gray']),
      }),
    )
    .default([]),
  include: z.array(z.string()).default([]),
});

const hookConfigSchema = z.object({
  pre_start: z.string().optional(),
  post_start: z.string().optional(),
  pre_stop: z.string().optional(),
  post_stop: z.string().optional(),
});

// Default `never`: a process that crashes stays crashed. Opting into auto-retry
// is a deliberate choice (set `restart: on-failure` or `always`) — silent retry
// loops on a fundamentally broken process produce noise and obscure the real
// error.
const restartPolicySchema = z.enum(['always', 'on-failure', 'never']).default('never');

const processTypeSchema = z.enum(['bash', 'webpack', 'angular', 'docker']).default('bash');

const DOCKER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export const processConfigSchema = z
  .object({
    category: z.string().default('default'),
    type: processTypeSchema,
    command: z.string().min(1),
    /**
     * Shell command run during shutdown *instead of* SIGTERM. Use it for CLI
     * clients that manage external resources their own process doesn't directly
     * own — e.g. `docker run`, where killing the local CLI doesn't necessarily
     * stop the container. orckit fires the command, then waits the normal grace
     * period for the main process to exit; if it's still alive at the end of
     * the grace window it gets SIGKILLed as a last resort. Falls back to plain
     * SIGTERM when unset.
     *
     * For `type: docker`, this defaults to `docker rm -f <container_name>` when
     * not set explicitly.
     */
    stop_command: z.string().optional(),
    /**
     * Required when `type: docker`; the container handle orckit uses to clean
     * up orphans before spawn (a `docker rm -f` is run before `pre_start`) and
     * to tear the container down on shutdown (used as the default
     * `stop_command`). Must match the `--name=<...>` flag in the docker command.
     * Rejected for non-docker process types.
     */
    container_name: z
      .string()
      .min(1)
      .regex(
        DOCKER_NAME_RE,
        'invalid Docker container name (must match [a-zA-Z0-9][a-zA-Z0-9_.-]*)',
      )
      .optional(),
    cwd: z.string().optional(),
    env: z.record(z.string(), z.string()).default({}),
    depends_on: z.array(z.string()).default([]),
    ready: readyCheckSchema.optional(),
    restart: restartPolicySchema,
    restart_delay_ms: z.number().int().nonnegative().default(2000),
    max_retries: z.number().int().nonnegative().default(3),
    output: outputFilterSchema.optional(),
    hooks: hookConfigSchema.optional(),
    buffer_size: z.number().int().positive().default(1000),
    /**
     * When true, a boot-time failure of this process does NOT abort `orc start`.
     * The orchestrator stays alive with the process in `failed` state and any
     * dependents `pending`; the user can fix the underlying issue and type
     * `r <name>` at the prompt to retry.
     *
     * Default false (strict): a single failure aborts the boot.
     */
    manual_retry: z.boolean().default(false),
    /**
     * When true, this process is NOT started by `orc start` with no targets.
     * Use for ancillary tools you sometimes want (admin UIs, log viewers,
     * background monitors). To start it:
     *   - explicitly: `orc start <name>` (starts only it + its deps)
     *   - additively: `orc start --with <name>` (default set + this)
     *   - at runtime: `start <name>` at the REPL, or click ▶ in the web UI
     * A required (non-optional) process is not allowed to `depends_on` an
     * optional one — that would force the optional one to always start,
     * defeating the purpose.
     */
    optional: z.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'docker' && !data.container_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'container_name is required when type is "docker"',
        path: ['container_name'],
      });
    }
    if (data.type !== 'docker' && data.container_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `container_name only applies to type: docker (got type: ${data.type})`,
        path: ['container_name'],
      });
    }
  });

const preflightCheckSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  on_fail: z.string().optional(),
});

const logsConfigSchema = z.object({
  /**
   * When true, every process's stdout/stderr is appended to a per-process file
   * under `dir`. A header line marks each spawn (initial start, auto-restart,
   * manual retry) so a single file can carry many sessions.
   */
  enabled: z.boolean().default(false),
  /** Directory (relative to cwd or absolute) for log files. */
  dir: z.string().default('.orckit/logs'),
});

const mcpConfigSchema = z.object({
  /**
   * When true, `orc start` additionally listens on `host:port` as a
   * Model Context Protocol server over Streamable HTTP. Claude Code (and any
   * MCP client) can connect to query process status, errors, and recent
   * output without spawning its own `orc`.
   */
  enabled: z.boolean().default(true),
  port: z.number().int().min(1).max(65_535).default(7676),
  host: z.string().default('127.0.0.1'),
});

const webConfigSchema = z.object({
  /**
   * When true, `orc start` additionally serves an in-process browser
   * dashboard on `host:port`. Pure reporter on top of the public event
   * API; does not affect orchestration. Disable to skip binding the port.
   */
  enabled: z.boolean().default(true),
  port: z.number().int().min(1).max(65_535).default(7677),
  host: z.string().default('127.0.0.1'),
});

export const orckitConfigSchema = z
  .object({
    project: z.string().default('orckit'),
    processes: z.record(z.string(), processConfigSchema).refine((p) => Object.keys(p).length > 0, {
      message: 'at least one process is required',
    }),
    preflight: z.array(preflightCheckSchema).default([]),
    logs: logsConfigSchema.default({ enabled: false, dir: '.orckit/logs' }),
    mcp: mcpConfigSchema.default({ enabled: true, port: 7676, host: '127.0.0.1' }),
    web: webConfigSchema.default({ enabled: true, port: 7677, host: '127.0.0.1' }),
  })
  .superRefine((data, ctx) => {
    // A required process can't depend on an optional one — if `optional: true`
    // is honored, the required process would never start; if we silently
    // override the optional flag, the user's intent is lost. Reject early.
    for (const [name, process] of Object.entries(data.processes)) {
      if (process.optional) continue;
      for (const depName of process.depends_on) {
        const dep = data.processes[depName];
        if (dep?.optional) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['processes', name, 'depends_on'],
            message: `required process "${name}" cannot depend on optional process "${depName}" — either mark "${name}" optional too, or drop "optional: true" from "${depName}"`,
          });
        }
      }
    }
  });

export type OrckitConfig = z.infer<typeof orckitConfigSchema>;
export type ProcessConfig = z.infer<typeof processConfigSchema>;
export type ReadyCheck = z.infer<typeof readyCheckSchema>;
export type HttpReadyCheck = z.infer<typeof httpReadyCheck>;
export type TcpReadyCheck = z.infer<typeof tcpReadyCheck>;
export type LogPatternReadyCheck = z.infer<typeof logPatternReadyCheck>;
export type ExitCodeReadyCheck = z.infer<typeof exitCodeReadyCheck>;
export type CustomReadyCheck = z.infer<typeof customReadyCheck>;
export type OutputFilter = z.infer<typeof outputFilterSchema>;
export type HookConfig = z.infer<typeof hookConfigSchema>;
export type RestartPolicy = z.infer<typeof restartPolicySchema>;
export type ProcessType = z.infer<typeof processTypeSchema>;
export type PreflightCheck = z.infer<typeof preflightCheckSchema>;
export type LogsConfig = z.infer<typeof logsConfigSchema>;
export type McpConfig = z.infer<typeof mcpConfigSchema>;
export type WebConfig = z.infer<typeof webConfigSchema>;
