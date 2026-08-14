import type { OrckitSnapshot, OutputLine } from './types';

/**
 * REST + SSE client for the orckit web server.
 *
 * In production both the frontend and the server are same-origin so the base
 * URL is "". In `pnpm dev:web` the Vite dev server proxies /api and /events
 * to the real orckit on 7677, so "" still works.
 */

export async function fetchState(): Promise<OrckitSnapshot> {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error(`GET /api/state failed: ${res.status}`);
  return (await res.json()) as OrckitSnapshot;
}

export async function fetchOutput(name: string): Promise<OutputLine[]> {
  const res = await fetch(`/api/output/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`GET /api/output/${name} failed: ${res.status}`);
  const body = (await res.json()) as { lines: OutputLine[] };
  return body.lines;
}

export async function restartProcess(name: string): Promise<void> {
  const res = await fetch(`/api/restart/${encodeURIComponent(name)}`, { method: 'POST' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `restart failed: ${res.status}`);
  }
}

export async function stopProcess(name: string): Promise<void> {
  const res = await fetch(`/api/stop/${encodeURIComponent(name)}`, { method: 'POST' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `stop failed: ${res.status}`);
  }
}

export async function startProcess(name: string): Promise<void> {
  const res = await fetch(`/api/start/${encodeURIComponent(name)}`, { method: 'POST' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `start failed: ${res.status}`);
  }
}

/**
 * Ask orckit to open a file in the user's IDE (it runs the IDE's command-line
 * launcher server-side). `file` must be absolute; `line`/`col` are 1-based.
 * Throws with the server's error message on failure (e.g. launcher not found).
 */
export async function openInIde(file: string, line?: number, col?: number): Promise<void> {
  const params = new URLSearchParams({ file });
  if (line != null) params.set('line', String(line));
  if (col != null) params.set('column', String(col));
  const res = await fetch(`/api/open?${params.toString()}`, { method: 'POST' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `open failed: ${res.status}`);
  }
}
