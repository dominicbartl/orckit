/**
 * Port utilities for checking availability and finding what's using ports
 */

import { execa } from 'execa';
import { createConnection } from 'net';
import { createDebugLogger } from './logger.js';

const debug = createDebugLogger('PortUtils');

/**
 * Information about a process using a port
 */
export interface PortUser {
  pid: number;
  processName: string;
  command: string;
  user?: string;
}

/**
 * Result of a port check
 */
export interface PortCheckResult {
  available: boolean;
  port: number;
  user?: PortUser;
}

/**
 * Check if a port is available
 *
 * @param port - Port number to check
 * @returns Promise resolving to true if port is available
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  debug.debug('Checking port availability', { port });

  return new Promise((resolve) => {
    const socket = createConnection({ port, host: 'localhost' });

    socket.on('connect', () => {
      socket.destroy();
      debug.debug('Port is in use', { port });
      resolve(false); // Port is in use
    });

    socket.on('error', () => {
      debug.debug('Port is available', { port });
      resolve(true); // Port is available
    });
  });
}

/**
 * Get information about what process is using a port (macOS/Linux)
 *
 * @param port - Port number to check
 * @returns Process information or null if nothing is using the port
 */
export async function getPortUser(port: number): Promise<PortUser | null> {
  debug.debug('Getting port user info', { port });

  try {
    // Try lsof first (most detailed)
    const result = await execa('lsof', ['-i', `:${port}`, '-P', '-n', '-t', '-sTCP:LISTEN'], {
      reject: false,
    });

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      debug.debug('No process found using port', { port });
      return null;
    }

    const pid = parseInt(result.stdout.trim().split('\n')[0], 10);

    // Get detailed process info
    const psResult = await execa('ps', ['-p', String(pid), '-o', 'comm=,command=,user='], {
      reject: false,
    });

    if (psResult.exitCode === 0 && psResult.stdout.trim()) {
      const lines = psResult.stdout.trim().split('\n');
      const parts = lines[0].split(/\s+/);

      // Parse ps output: COMM COMMAND USER
      const processName = parts[0] || 'unknown';
      const user = parts[parts.length - 1] || 'unknown';
      const command = psResult.stdout.trim();

      debug.info('Found process using port', {
        port,
        pid,
        processName,
        user,
      });

      return {
        pid,
        processName,
        command,
        user,
      };
    }

    // Fallback: just return PID
    debug.debug('Got PID but could not get full process info', { port, pid });
    return {
      pid,
      processName: 'unknown',
      command: `PID ${pid}`,
    };
  } catch (error) {
    debug.warn('Error getting port user info', {
      port,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

/**
 * Check a port and get information about what's using it
 *
 * @param port - Port number to check
 * @returns Port check result with user information if applicable
 */
export async function checkPort(port: number): Promise<PortCheckResult> {
  debug.debug('Checking port', { port });

  const available = await isPortAvailable(port);

  if (available) {
    debug.debug('Port is available', { port });
    return { available: true, port };
  }

  // Port is in use, get user info
  debug.debug('Port is in use, getting user info', { port });
  const user = await getPortUser(port);

  return {
    available: false,
    port,
    user: user ?? undefined,
  };
}

/**
 * Format a user-friendly message about a port conflict
 *
 * @param port - Port number
 * @param user - Process using the port
 * @returns Formatted error message
 */
export function formatPortConflictMessage(port: number, user?: PortUser): string {
  if (!user) {
    return `Port ${port} is already in use by another process`;
  }

  let message = `Port ${port} is already in use\n`;
  message += `  Process: ${user.processName} (PID: ${user.pid})\n`;

  if (user.command && user.command !== `PID ${user.pid}`) {
    message += `  Command: ${user.command}\n`;
  }

  if (user.user) {
    message += `  User: ${user.user}\n`;
  }

  message += `\nTo free this port, you can:\n`;
  message += `  1. Stop the process: kill ${user.pid}\n`;
  message += `  2. Use a different port in your configuration\n`;
  message += `  3. Check if this is a leftover process from a previous run`;

  return message;
}

/**
 * Check multiple ports and return any conflicts
 *
 * @param ports - Array of port numbers to check
 * @returns Array of port check results for ports that are in use
 */
export async function checkPorts(ports: number[]): Promise<PortCheckResult[]> {
  debug.debug('Checking multiple ports', { ports });

  const results = await Promise.all(ports.map((port) => checkPort(port)));
  const conflicts = results.filter((result) => !result.available);

  if (conflicts.length > 0) {
    debug.warn('Found port conflicts', {
      count: conflicts.length,
      ports: conflicts.map((c) => c.port),
    });
  } else {
    debug.info('All ports are available', { ports });
  }

  return conflicts;
}

/**
 * Extract port numbers from a configuration
 * Common patterns: localhost:3000, http://localhost:4200, :5432
 *
 * @param text - Text to extract ports from
 * @returns Array of unique port numbers
 */
export function extractPorts(text: string): number[] {
  const ports = new Set<number>();

  // Pattern 1: :PORT (most common)
  const colonPattern = /:(\d{2,5})\b/g;
  let match;

  while ((match = colonPattern.exec(text)) !== null) {
    const port = parseInt(match[1], 10);
    if (port >= 1 && port <= 65535) {
      ports.add(port);
    }
  }

  // Pattern 2: PORT= or port=
  const portEnvPattern = /\bport[=\s]+(\d{2,5})/gi;
  while ((match = portEnvPattern.exec(text)) !== null) {
    const port = parseInt(match[1], 10);
    if (port >= 1 && port <= 65535) {
      ports.add(port);
    }
  }

  debug.debug('Extracted ports from text', {
    text: text.substring(0, 100),
    ports: Array.from(ports),
  });

  return Array.from(ports);
}
