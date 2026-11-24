import type { ParsedLogEntry } from './types';

/**
 * A process's parsed log entries on the client, tagged with the connection
 * ("generation") they belong to. The server restarts entry ids at 0 on every
 * reconnect, so entries are only ever compared within one generation.
 *
 * Two feeds fill it and can arrive in either order: the `/api/logs/:name`
 * fetch (history) and the SSE `parsed:*` events (live). These pure merge rules
 * make the result the same either way.
 */
export interface ParsedBuffer {
  generation: number;
  entries: ParsedLogEntry[];
}

/** Mirrors the server's default `parsed_logs.buffer_size`. */
export const MAX_PARSED_ENTRIES = 5000;

function trim(entries: ParsedLogEntry[]): ParsedLogEntry[] {
  return entries.length > MAX_PARSED_ENTRIES ? entries.slice(-MAX_PARSED_ENTRIES) : entries;
}

const lastId = (entries: ParsedLogEntry[]) => entries.at(-1)?.id ?? -1;

/** A live `parsed:entries` batch. */
export function applyBatch(
  buf: ParsedBuffer | undefined,
  generation: number,
  batch: ParsedLogEntry[],
): ParsedBuffer | undefined {
  // A newer generation without its reset (the event was missed): adopt it.
  if (!buf || generation > buf.generation) return { generation, entries: trim(batch) };
  if (generation < buf.generation) return buf;
  // Same generation: anything at or below the last id came with the fetch.
  const after = lastId(buf.entries);
  const fresh = batch.filter((e) => e.id > after);
  return fresh.length === 0 ? buf : { generation, entries: trim([...buf.entries, ...fresh]) };
}

/** A `parsed:reset` — the source reconnected and its history replays next. */
export function applyReset(
  buf: ParsedBuffer | undefined,
  generation: number,
): ParsedBuffer | undefined {
  if (buf && generation < buf.generation) return buf;
  return { generation, entries: [] };
}

/** The `/api/logs/:name` response. */
export function applyHydration(buf: ParsedBuffer | undefined, fetched: ParsedBuffer): ParsedBuffer {
  if (!buf || fetched.generation > buf.generation) {
    return { generation: fetched.generation, entries: trim(fetched.entries) };
  }
  if (fetched.generation < buf.generation) return buf;
  // Same generation: the fetch is the history; keep what streamed in after it.
  const after = lastId(fetched.entries);
  const streamed = buf.entries.filter((e) => e.id > after);
  return { generation: buf.generation, entries: trim([...fetched.entries, ...streamed]) };
}
