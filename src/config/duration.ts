const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

export function parseDuration(input: string): number {
  const match = input.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (!match) {
    throw new Error(`invalid duration "${input}" — expected e.g. "500ms", "5s", "10m", "1h"`);
  }
  const [, value, unit] = match;
  return Math.round(Number(value) * UNIT_MS[unit!]!);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}
