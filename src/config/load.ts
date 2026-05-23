import { readFileSync } from 'node:fs';
import { load as parseYaml } from 'js-yaml';
import { orckitConfigSchema, type OrckitConfig } from './schema.js';

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly source?: string,
  ) {
    super(source ? `${source}: ${message}` : message);
    this.name = 'ConfigError';
  }
}

export function parseConfigText(text: string, source?: string): OrckitConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new ConfigError(`invalid YAML: ${(err as Error).message}`, source);
  }
  return validateConfig(raw, source);
}

export function loadConfig(configPath: string): OrckitConfig {
  let text: string;
  try {
    text = readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new ConfigError(`cannot read file: ${(err as Error).message}`, configPath);
  }
  return parseConfigText(text, configPath);
}

export function validateConfig(raw: unknown, source?: string): OrckitConfig {
  const result = orckitConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`invalid configuration:\n${issues}`, source);
  }
  return result.data;
}
