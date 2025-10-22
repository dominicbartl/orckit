/**
 * Zod schema for Orckit configuration validation
 */

import { z } from 'zod';

/**
 * HTTP ready check schema
 */
const httpReadyCheckSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  timeout: z.number().positive().optional().default(60000),
  expectedStatus: z.number().optional().default(200),
  interval: z.number().positive().optional().default(1000),
  maxAttempts: z.number().positive().optional().default(60),
});

/**
 * TCP ready check schema
 */
const tcpReadyCheckSchema = z.object({
  type: z.literal('tcp'),
  host: z.string(),
  port: z.number().int().min(1).max(65535),
  timeout: z.number().positive().optional().default(60000),
  interval: z.number().positive().optional().default(1000),
  maxAttempts: z.number().positive().optional().default(60),
});

/**
 * Exit code ready check schema
 */
const exitCodeReadyCheckSchema = z.object({
  type: z.literal('exit-code'),
  timeout: z.number().positive().optional().default(60000),
});

/**
 * Log pattern ready check schema
 */
const logPatternReadyCheckSchema = z.object({
  type: z.literal('log-pattern'),
  pattern: z.string(),
  timeout: z.number().positive().optional().default(60000),
});

/**
 * Custom ready check schema
 */
const customReadyCheckSchema = z.object({
  type: z.literal('custom'),
  command: z.string(),
  timeout: z.number().positive().optional().default(60000),
  interval: z.number().positive().optional().default(1000),
  maxAttempts: z.number().positive().optional().default(60),
});

/**
 * Union schema for ready checks
 */
export const readyCheckSchema = z.discriminatedUnion('type', [
  httpReadyCheckSchema,
  tcpReadyCheckSchema,
  exitCodeReadyCheckSchema,
  logPatternReadyCheckSchema,
  customReadyCheckSchema,
]);

/**
 * Output filter configuration schema
 */
const outputFilterSchema = z.object({
  suppress_patterns: z.array(z.string()).optional(),
  highlight_patterns: z
    .array(
      z.object({
        pattern: z.string(),
        color: z.string(),
      })
    )
    .optional(),
  include_patterns: z.array(z.string()).optional(),
});

/**
 * Output format configuration schema
 */
const outputFormatSchema = z.object({
  timestamp: z.boolean().optional().default(false),
  prefix: z.string().optional(),
  max_lines: z.number().positive().optional().default(1000),
});

/**
 * Output configuration schema
 */
const outputConfigSchema = z.object({
  filter: outputFilterSchema.optional(),
  format: outputFormatSchema.optional(),
});

/**
 * Process hooks schema
 */
const processHooksSchema = z.object({
  pre_start: z.string().optional(),
  post_start: z.string().optional(),
  pre_stop: z.string().optional(),
  post_stop: z.string().optional(),
});

/**
 * Build integration schema
 */
const buildIntegrationSchema = z.object({
  mode: z.enum(['deep', 'logs-only']).optional().default('logs-only'),
});

/**
 * Process configuration schema
 */
export const processConfigSchema = z.object({
  category: z.string(),
  type: z
    .enum(['bash', 'docker', 'node', 'ts-node', 'webpack', 'angular', 'vite', 'build'])
    .optional()
    .default('bash'),
  command: z.string(),
  cwd: z.string().optional(),
  dependencies: z.array(z.string()).optional().default([]),
  restart: z.enum(['always', 'on-failure', 'never']).optional().default('on-failure'),
  restart_delay: z.string().optional().default('5s'),
  max_retries: z.number().int().nonnegative().optional().default(3),
  env: z.record(z.string()).optional().default({}),
  ready: readyCheckSchema.optional(),
  output: outputConfigSchema.optional(),
  hooks: processHooksSchema.optional(),
  integration: buildIntegrationSchema.optional(),
  config: z.string().optional(),
  preflight: z.array(z.string()).optional().default([]),
});

/**
 * Category configuration schema
 */
const categoryConfigSchema = z.object({
  window: z.string(),
});

/**
 * Global hooks schema
 */
const globalHooksSchema = z.object({
  pre_start_all: z.string().optional(),
  post_start_all: z.string().optional(),
  pre_stop_all: z.string().optional(),
  post_stop_all: z.string().optional(),
});

/**
 * Preflight check schema
 */
const preflightCheckSchema = z.object({
  name: z.string(),
  command: z.string(),
  error: z.string(),
  fix: z.string().optional(),
});

/**
 * Preflight configuration schema
 */
const preflightConfigSchema = z.object({
  checks: z.array(preflightCheckSchema).optional().default([]),
});

/**
 * Boot configuration schema
 */
const bootConfigSchema = z.object({
  style: z.enum(['timeline', 'dashboard', 'minimal', 'quiet']).optional().default('timeline'),
  show_preflight: z.boolean().optional().default(true),
  show_graph: z.boolean().optional().default(true),
  show_progress_bars: z.boolean().optional().default(true),
  show_hooks: z.boolean().optional().default(true),
  show_timing: z.boolean().optional().default(true),
  collapse_successful: z.boolean().optional().default(false),
});

/**
 * Maestro configuration schema
 */
const maestroConfigSchema = z.object({
  boot: bootConfigSchema.optional(),
});

/**
 * Complete Orckit configuration schema
 */
export const orckitConfigSchema = z.object({
  version: z.string().optional().default('1'),
  project: z.string().optional(),
  categories: z.record(categoryConfigSchema).optional().default({}),
  processes: z.record(processConfigSchema),
  hooks: globalHooksSchema.optional(),
  preflight: preflightConfigSchema.optional(),
  maestro: maestroConfigSchema.optional(),
});

export type OrckitConfigSchema = z.infer<typeof orckitConfigSchema>;
export type ProcessConfigSchema = z.infer<typeof processConfigSchema>;
