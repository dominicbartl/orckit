/**
 * Health check system for determining when processes are ready
 */

import { execa } from 'execa';
import fetch from 'node-fetch';
import { createConnection } from 'net';
import type {
  ReadyCheck,
  HttpReadyCheck,
  TcpReadyCheck,
  LogPatternReadyCheck,
  CustomReadyCheck,
} from '../../types/index.js';
import { checkPort, formatPortConflictMessage } from '../../utils/port.js';
import { createDebugLogger } from '../../utils/logger.js';

const debug = createDebugLogger('HealthChecker');

/**
 * Result of a health check attempt
 */
export interface HealthCheckResult {
  success: boolean;
  message?: string;
  error?: Error;
}

/**
 * Health checker interface
 */
export interface HealthChecker {
  check(): Promise<HealthCheckResult>;
}

/**
 * HTTP health checker
 */
export class HttpHealthChecker implements HealthChecker {
  constructor(private config: HttpReadyCheck) {}

  async check(): Promise<HealthCheckResult> {
    debug.debug('Checking HTTP endpoint', { url: this.config.url });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // 5s per attempt

      const response = await fetch(this.config.url, {
        signal: controller.signal,
        method: 'GET',
      });

      clearTimeout(timeout);

      const expectedStatus = this.config.expectedStatus ?? 200;

      if (response.status === expectedStatus) {
        debug.debug('HTTP check successful', {
          url: this.config.url,
          status: response.status,
        });
        return {
          success: true,
          message: `HTTP ${response.status} OK`,
        };
      } else {
        debug.debug('HTTP check failed - unexpected status', {
          url: this.config.url,
          expected: expectedStatus,
          actual: response.status,
        });
        return {
          success: false,
          message: `Expected status ${expectedStatus}, got ${response.status}`,
        };
      }
    } catch (error) {
      debug.debug('HTTP check failed', {
        url: this.config.url,
        error: error instanceof Error ? error.message : error,
      });

      // Try to extract port and provide port conflict info
      const urlMatch = this.config.url.match(/:(\d+)/);
      if (urlMatch) {
        const port = parseInt(urlMatch[1], 10);
        if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
          const portCheck = await checkPort(port);
          if (!portCheck.available && portCheck.user) {
            const detailedMessage = formatPortConflictMessage(port, portCheck.user);
            debug.info('Port conflict detected for HTTP check', {
              port,
              user: portCheck.user,
            });
            return {
              success: false,
              message: detailedMessage,
              error: error,
            };
          }
        }
      }

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}

/**
 * TCP health checker
 */
export class TcpHealthChecker implements HealthChecker {
  constructor(private config: TcpReadyCheck) {}

  async check(): Promise<HealthCheckResult> {
    debug.debug('Checking TCP connection', {
      host: this.config.host,
      port: this.config.port,
    });

    return new Promise((resolve) => {
      const socket = createConnection({
        host: this.config.host,
        port: this.config.port,
        timeout: 5000, // 5s per attempt
      });

      socket.on('connect', () => {
        socket.end();
        debug.debug('TCP connection successful', {
          host: this.config.host,
          port: this.config.port,
        });
        resolve({
          success: true,
          message: `TCP connection to ${this.config.host}:${this.config.port} successful`,
        });
      });

      socket.on('error', async (error) => {
        debug.debug('TCP connection failed', {
          host: this.config.host,
          port: this.config.port,
          error: error.message,
        });

        // Check if port is in use and provide detailed info
        if (error.message.includes('ECONNREFUSED') && this.config.host === 'localhost') {
          const portCheck = await checkPort(this.config.port);
          if (!portCheck.available && portCheck.user) {
            const detailedMessage = formatPortConflictMessage(
              this.config.port,
              portCheck.user
            );
            debug.info('Port conflict detected', {
              port: this.config.port,
              user: portCheck.user,
            });
            resolve({
              success: false,
              message: detailedMessage,
              error,
            });
            return;
          }
        }

        resolve({
          success: false,
          message: error.message,
          error,
        });
      });

      socket.on('timeout', () => {
        socket.destroy();
        debug.debug('TCP connection timeout', {
          host: this.config.host,
          port: this.config.port,
        });
        resolve({
          success: false,
          message: 'Connection timeout',
        });
      });
    });
  }
}

/**
 * Log pattern health checker
 * Waits for a specific pattern to appear in the process output
 */
export class LogPatternHealthChecker implements HealthChecker {
  private patternFound = false;

  constructor(private config: LogPatternReadyCheck) {}

  /**
   * Check if pattern has been found
   */
  check(): Promise<HealthCheckResult> {
    return Promise.resolve(this.checkSync());
  }

  /**
   * Synchronous check
   */
  checkSync(): HealthCheckResult {
    if (this.patternFound) {
      return {
        success: true,
        message: `Pattern matched: ${this.config.pattern}`,
      };
    }

    return {
      success: false,
      message: 'Pattern not found yet',
    };
  }

  /**
   * Process a log line to check for pattern
   *
   * @param line - Log line to process
   * @returns True if pattern is found
   */
  processLogLine(line: string): boolean {
    if (this.patternFound) {
      return true;
    }

    const regex = new RegExp(this.config.pattern);
    if (regex.test(line)) {
      this.patternFound = true;
      return true;
    }

    return false;
  }

  /**
   * Reset the checker state
   */
  reset() {
    this.patternFound = false;
  }
}

/**
 * Custom command health checker
 */
export class CustomHealthChecker implements HealthChecker {
  constructor(private config: CustomReadyCheck) {}

  async check(): Promise<HealthCheckResult> {
    try {
      const result = await execa('bash', ['-c', this.config.command], {
        timeout: 5000, // 5s per attempt
        reject: false,
      });

      if (result.exitCode === 0) {
        return {
          success: true,
          message: 'Custom check passed',
        };
      } else {
        return {
          success: false,
          message: `Custom check failed with exit code ${result.exitCode}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}

/**
 * Wait for a health check to pass
 *
 * @param checker - Health checker to use
 * @param config - Ready check configuration
 * @param onAttempt - Callback for each attempt
 * @returns Promise that resolves when check passes or rejects on timeout
 */
export async function waitForReady(
  checker: HealthChecker,
  config: ReadyCheck,
  onAttempt?: (attempt: number, result: HealthCheckResult) => void
): Promise<void> {
  const timeout = config.timeout ?? 60000;
  const interval = 'interval' in config ? (config.interval ?? 1000) : 1000;
  const maxAttempts = 'maxAttempts' in config ? (config.maxAttempts ?? 60) : 60;

  const startTime = Date.now();
  let attempt = 0;

  while (Date.now() - startTime < timeout && attempt < maxAttempts) {
    attempt++;

    const result = await checker.check();

    if (onAttempt) {
      onAttempt(attempt, result);
    }

    if (result.success) {
      return;
    }

    // Wait before next attempt
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(
    `Health check failed after ${attempt} attempts (${Math.round((Date.now() - startTime) / 1000)}s)`
  );
}

/**
 * Create a health checker for a ready check configuration
 *
 * @param config - Ready check configuration
 * @returns Health checker instance
 */
export function createHealthChecker(config: ReadyCheck): HealthChecker {
  switch (config.type) {
    case 'http':
      return new HttpHealthChecker(config);
    case 'tcp':
      return new TcpHealthChecker(config);
    case 'log-pattern':
      return new LogPatternHealthChecker(config);
    case 'custom':
      return new CustomHealthChecker(config);
    case 'exit-code':
      // Exit code check is handled differently - process needs to exit with 0
      throw new Error('Exit code health check should be handled by process runner');
    default:
      throw new Error(`Unknown health check type: ${(config as ReadyCheck).type}`);
  }
}
