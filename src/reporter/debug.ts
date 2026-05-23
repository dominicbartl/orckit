type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const envLevel = (process.env.ORCKIT_LOG_LEVEL ?? 'info').toLowerCase() as Level;
const minRank = LEVEL_RANK[envLevel] ?? LEVEL_RANK.info;
const enabledNamespaces = parseEnabledNamespaces(process.env.ORCKIT_DEBUG);

export interface Debug {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export function createDebug(namespace: string): Debug {
  const isEnabled = (level: Level): boolean => {
    if (LEVEL_RANK[level] < minRank) return false;
    if (level === 'debug' && !namespaceEnabled(namespace)) return false;
    return true;
  };
  const emit = (level: Level, message: string, data?: unknown) => {
    if (!isEnabled(level)) return;
    const prefix = `[${level}] ${namespace}:`;
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (data !== undefined) fn(prefix, message, data);
    else fn(prefix, message);
  };
  return {
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
  };
}

function parseEnabledNamespaces(value: string | undefined): Set<string> | '*' | null {
  if (!value) return null;
  if (value === '*' || value === 'true' || value === '1') return '*';
  return new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function namespaceEnabled(ns: string): boolean {
  if (enabledNamespaces === '*') return true;
  if (!enabledNamespaces) return false;
  return enabledNamespaces.has(ns);
}
