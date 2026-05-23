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

const restartPolicySchema = z.enum(['always', 'on-failure', 'never']).default('on-failure');

const processTypeSchema = z.enum(['bash', 'webpack', 'angular']).default('bash');

export const processConfigSchema = z.object({
  category: z.string().default('default'),
  type: processTypeSchema,
  command: z.string().min(1),
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
});

const preflightCheckSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  on_fail: z.string().optional(),
});

export const orckitConfigSchema = z.object({
  project: z.string().default('orckit'),
  processes: z.record(z.string(), processConfigSchema).refine((p) => Object.keys(p).length > 0, {
    message: 'at least one process is required',
  }),
  preflight: z.array(preflightCheckSchema).default([]),
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
