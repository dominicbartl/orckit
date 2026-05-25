import { execa } from 'execa';
import { connect } from 'node:net';
import type {
  CustomReadyCheck,
  HttpReadyCheck,
  LogPatternReadyCheck,
  ReadyCheck,
  TcpReadyCheck,
} from '../config/schema.js';

export interface ProbeResult {
  ok: boolean;
  reason?: string;
}

export interface HealthProbe {
  readonly intervalMs: number;
  readonly timeoutMs: number;
  check(): Promise<ProbeResult>;
  feedLine?(line: string): void;
}

export function createProbe(config: Exclude<ReadyCheck, { type: 'exit-code' }>): HealthProbe {
  switch (config.type) {
    case 'http':
      return new HttpProbe(config);
    case 'tcp':
      return new TcpProbe(config);
    case 'log-pattern':
      return new LogPatternProbe(config);
    case 'custom':
      return new CustomProbe(config);
  }
}

/**
 * Extract the local listen endpoint a ready check targets, if any. Used to
 * pre-flight that the port is actually free before spawning — otherwise a
 * stale process on the same port would let the probe report a false "ready"
 * while the newly spawned command fails to bind. Returns null for checks
 * that don't pin a local port (log-pattern, custom, or remote-host probes).
 */
export function readyCheckLocalEndpoint(
  ready: ReadyCheck | undefined,
): { host: string; port: number } | null {
  if (!ready) return null;
  if (ready.type === 'tcp') {
    if (!isLocalHost(ready.host)) return null;
    return { host: ready.host, port: ready.port };
  }
  if (ready.type === 'http') {
    try {
      const u = new URL(ready.url);
      if (!isLocalHost(u.hostname)) return null;
      const port = u.port
        ? Number(u.port)
        : u.protocol === 'https:'
          ? 443
          : u.protocol === 'http:'
            ? 80
            : NaN;
      if (!Number.isFinite(port)) return null;
      return { host: u.hostname, port };
    } catch {
      return null;
    }
  }
  return null;
}

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1';
}

const ATTEMPT_TIMEOUT_MS = 5000;

class HttpProbe implements HealthProbe {
  readonly intervalMs: number;
  readonly timeoutMs: number;

  constructor(private readonly config: HttpReadyCheck) {
    this.intervalMs = config.interval_ms;
    this.timeoutMs = config.timeout_ms;
  }

  async check(): Promise<ProbeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const response = await fetch(this.config.url, { signal: controller.signal });
      if (response.status === this.config.expected_status) {
        return { ok: true };
      }
      return {
        ok: false,
        reason: `HTTP ${response.status} (expected ${this.config.expected_status})`,
      };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }
}

class TcpProbe implements HealthProbe {
  readonly intervalMs: number;
  readonly timeoutMs: number;

  constructor(private readonly config: TcpReadyCheck) {
    this.intervalMs = config.interval_ms;
    this.timeoutMs = config.timeout_ms;
  }

  check(): Promise<ProbeResult> {
    return new Promise((resolve) => {
      const socket = connect({ host: this.config.host, port: this.config.port });
      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve({ ok: false, reason: 'connection timeout' });
      }, ATTEMPT_TIMEOUT_MS);
      socket.once('connect', () => {
        clearTimeout(timer);
        cleanup();
        resolve({ ok: true });
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        cleanup();
        resolve({ ok: false, reason: err.message });
      });
    });
  }
}

class LogPatternProbe implements HealthProbe {
  readonly intervalMs = 100;
  readonly timeoutMs: number;
  private readonly regex: RegExp;
  private matched = false;

  constructor(private readonly config: LogPatternReadyCheck) {
    this.regex = new RegExp(config.pattern);
    this.timeoutMs = config.timeout_ms;
  }

  check(): Promise<ProbeResult> {
    return Promise.resolve(
      this.matched
        ? { ok: true }
        : { ok: false, reason: `awaiting pattern /${this.config.pattern}/` },
    );
  }

  feedLine(line: string): void {
    if (!this.matched && this.regex.test(line)) {
      this.matched = true;
    }
  }
}

class CustomProbe implements HealthProbe {
  readonly intervalMs: number;
  readonly timeoutMs: number;

  constructor(private readonly config: CustomReadyCheck) {
    this.intervalMs = config.interval_ms;
    this.timeoutMs = config.timeout_ms;
  }

  async check(): Promise<ProbeResult> {
    const result = await execa('bash', ['-c', this.config.command], {
      timeout: ATTEMPT_TIMEOUT_MS,
      reject: false,
    });
    if (result.exitCode === 0) return { ok: true };
    return { ok: false, reason: `command exited ${result.exitCode}` };
  }
}
