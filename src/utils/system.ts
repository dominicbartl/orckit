/**
 * System utility functions
 */

import { execa } from 'execa';
import { createServer } from 'net';

/**
 * Check if a command exists in the system PATH
 *
 * @param command - Command name to check
 * @returns True if command exists
 */
export async function commandExists(command: string): Promise<boolean> {
  try {
    await execa('which', [command]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a port is available
 *
 * @param port - Port number to check
 * @param host - Host to check on (default: 'localhost')
 * @returns True if port is available
 */
export async function isPortAvailable(port: number, host: string = 'localhost'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port, host);
  });
}

/**
 * Check if multiple ports are available
 *
 * @param ports - Array of port numbers
 * @returns Object mapping port numbers to availability
 */
export async function checkPortsAvailability(ports: number[]): Promise<Record<number, boolean>> {
  const results: Record<number, boolean> = {};

  await Promise.all(
    ports.map(async (port) => {
      results[port] = await isPortAvailable(port);
    })
  );

  return results;
}

/**
 * Get the current Node.js version
 *
 * @returns Node.js version object
 */
export function getNodeVersion(): { major: number; minor: number; patch: number } {
  const version = process.version.slice(1); // Remove 'v' prefix
  const [major, minor, patch] = version.split('.').map(Number);

  return { major, minor, patch };
}

/**
 * Check if Docker daemon is running
 *
 * @returns True if Docker is running
 */
export async function isDockerRunning(): Promise<boolean> {
  try {
    await execa('docker', ['info'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if tmux is available
 *
 * @returns True if tmux is installed
 */
export async function isTmuxAvailable(): Promise<boolean> {
  return commandExists('tmux');
}

/**
 * Get tmux version
 *
 * @returns Tmux version string or null if not available
 */
export async function getTmuxVersion(): Promise<string | null> {
  try {
    const { stdout } = await execa('tmux', ['-V']);
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Kill a process tree by PID
 *
 * @param pid - Process ID
 * @param signal - Signal to send (default: 'SIGTERM')
 */
export async function killProcessTree(pid: number, signal: string = 'SIGTERM'): Promise<void> {
  try {
    // Use tree-kill for proper process tree termination
    const treeKill = (await import('tree-kill')).default;

    return new Promise((resolve, reject) => {
      treeKill(pid, signal, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  } catch (_error) {
    // Fallback to simple kill
    process.kill(pid, signal);
  }
}

/**
 * Wait for a condition to be true
 *
 * @param condition - Function that returns a boolean or Promise<boolean>
 * @param timeout - Maximum time to wait in milliseconds
 * @param interval - Check interval in milliseconds
 * @returns Promise that resolves when condition is true or rejects on timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 30000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await Promise.resolve(condition());

    if (result) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Sleep for a specified duration
 *
 * @param ms - Duration in milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get environment with process-specific variables
 *
 * @param processEnv - Process-specific environment variables
 * @returns Merged environment object
 */
export function getProcessEnv(processEnv: Record<string, string> = {}): Record<string, string> {
  return {
    ...process.env,
    ...processEnv,
  } as Record<string, string>;
}
