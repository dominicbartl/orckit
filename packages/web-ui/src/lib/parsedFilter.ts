import { entrySearchText, entryStatus, statusClass, type StatusClass } from './logValue';
import type { LogLevel, ParsedLogEntry } from './types';

/**
 * Filters for the parsed log view. A `null` facet means "all values", so values
 * that only appear later are still shown; an array keeps exactly those.
 * Persisted per process as JSON, so everything here is plain data.
 */
export interface ParsedFilters {
  functions: string[] | null;
  /** Handler names, plus `NO_HANDLER` for request-less log lines. */
  handlers: string[] | null;
  levels: LogLevel[] | null;
  /** Empty = any status. Non-empty keeps only request logs in these classes. */
  statuses: StatusClass[];
  /** Show one row per function execution. */
  executions: boolean;
  /** Show the emulator's own lines (start-up, warnings, load errors). */
  system: boolean;
  search: string;
}

export const NO_HANDLER = '(no handler)';
export const LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug'];

export const DEFAULT_FILTERS: ParsedFilters = {
  functions: null,
  handlers: null,
  levels: null,
  statuses: [],
  executions: true,
  system: true,
  search: '',
};

export function isDefault(f: ParsedFilters): boolean {
  return (
    f.functions === null &&
    f.handlers === null &&
    f.levels === null &&
    f.statuses.length === 0 &&
    f.executions &&
    f.system &&
    f.search.trim() === ''
  );
}

/** Pre-built sets for matching many entries against one filter state. */
export interface CompiledFilters {
  functions: Set<string> | null;
  handlers: Set<string> | null;
  levels: Set<LogLevel> | null;
  statuses: Set<StatusClass> | null;
  executions: boolean;
  system: boolean;
  search: string;
}

export function compileFilters(f: ParsedFilters): CompiledFilters {
  return {
    functions: f.functions && new Set(f.functions),
    handlers: f.handlers && new Set(f.handlers),
    levels: f.levels && new Set(f.levels),
    statuses: f.statuses.length > 0 ? new Set(f.statuses) : null,
    executions: f.executions,
    system: f.system,
    search: f.search.trim().toLowerCase(),
  };
}

/**
 * Whether an entry passes. The function facet applies to everything that has
 * a function; handler and status filters only make sense for request logs, so
 * narrowing either hides executions and system lines.
 */
export function matchesFilters(entry: ParsedLogEntry, f: CompiledFilters): boolean {
  if (f.functions && !(entry.fn ? f.functions.has(entry.fn) : entry.kind === 'system'))
    return false;
  switch (entry.kind) {
    case 'execution':
      if (!f.executions || f.handlers || f.statuses) return false;
      break;
    case 'system':
      if (!f.system || f.handlers || f.statuses) return false;
      if (f.levels && !f.levels.has(entry.level)) return false;
      break;
    case 'log': {
      if (f.handlers && !f.handlers.has(entry.handler ?? NO_HANDLER)) return false;
      if (f.levels && !f.levels.has(entry.level)) return false;
      if (f.statuses) {
        const status = entryStatus(entry);
        const cls = status !== undefined ? statusClass(status) : undefined;
        if (!cls || !f.statuses.has(cls)) return false;
      }
      break;
    }
  }
  return f.search === '' || entrySearchText(entry).includes(f.search);
}

export interface FacetCounts {
  functions: Map<string, number>;
  handlers: Map<string, number>;
  levels: Map<LogLevel, number>;
  statuses: Map<StatusClass, number>;
}

/** Values seen per facet with how many entries carry each. */
export function facetCounts(entries: readonly ParsedLogEntry[]): FacetCounts {
  const counts: FacetCounts = {
    functions: new Map(),
    handlers: new Map(),
    levels: new Map(),
    statuses: new Map(),
  };
  const bump = <K>(map: Map<K, number>, key: K) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const e of entries) {
    if (e.fn) bump(counts.functions, e.fn);
    if (e.kind === 'execution') continue;
    bump(counts.levels, e.level);
    if (e.kind === 'log') {
      bump(counts.handlers, e.handler ?? NO_HANDLER);
      const status = entryStatus(e);
      const cls = status !== undefined ? statusClass(status) : undefined;
      if (cls) bump(counts.statuses, cls);
    }
  }
  return counts;
}

/** Load saved filters; anything missing or malformed falls back to the defaults. */
export function loadFilters(key: string): ParsedFilters {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_FILTERS;
    const saved = JSON.parse(raw) as Partial<ParsedFilters>;
    const list = <T>(v: unknown): T[] | null => (Array.isArray(v) ? (v as T[]) : null);
    return {
      functions: list<string>(saved.functions),
      handlers: list<string>(saved.handlers),
      levels: list<LogLevel>(saved.levels),
      statuses: list<StatusClass>(saved.statuses) ?? [],
      executions: saved.executions !== false,
      system: saved.system !== false,
      search: typeof saved.search === 'string' ? saved.search : '',
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function saveFilters(key: string, f: ParsedFilters): void {
  try {
    if (isDefault(f)) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(f));
  } catch {
    // storage blocked (private mode, quota) — filters just won't persist
  }
}
