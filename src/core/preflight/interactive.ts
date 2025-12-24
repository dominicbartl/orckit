/**
 * Interactive preflight check handlers
 */

import prompts from 'prompts';
import chalk from 'chalk';
import { execa } from 'execa';
import type { PortCheckResult } from '../../utils/port.js';
import { isDockerRunning } from '../../utils/system.js';
import { createDebugLogger } from '../../utils/logger.js';

const debug = createDebugLogger('InteractivePreflight');

/**
 * Handle port conflicts interactively
 * Shows conflicting processes and asks if they should be killed
 */
export async function handlePortConflicts(conflicts: PortCheckResult[]): Promise<boolean> {
  console.log(chalk.yellow('\n⚠️  Port conflicts detected:\n'));

  // Display all conflicts
  for (const conflict of conflicts) {
    console.log(chalk.red(`  Port ${conflict.port}:`));
    if (conflict.user) {
      const user = conflict.user;
      console.log(chalk.gray(`    Process: ${user.processName}`));
      console.log(chalk.gray(`    PID: ${user.pid}`));
      if (user.command && user.command !== `PID ${user.pid}`) {
        // Truncate long commands
        const cmd = user.command.length > 80 ? user.command.substring(0, 77) + '...' : user.command;
        console.log(chalk.gray(`    Command: ${cmd}`));
      }
      if (user.user) {
        console.log(chalk.gray(`    User: ${user.user}`));
      }
    } else {
      console.log(chalk.gray(`    (Unknown process)`));
    }
    console.log('');
  }

  // Ask if user wants to kill the processes
  const response = await prompts({
    type: 'confirm',
    name: 'killProcesses',
    message: 'Do you want to kill these processes and continue?',
    initial: false,
  });

  // User cancelled (Ctrl+C)
  if (response.killProcesses === undefined) {
    console.log(chalk.yellow('\n✗ Setup cancelled'));
    return false;
  }

  // User chose not to kill
  if (!response.killProcesses) {
    console.log(chalk.yellow('\n✗ Cannot continue with port conflicts'));
    console.log(chalk.gray('  Please free these ports manually or update your configuration'));
    return false;
  }

  // Kill the processes
  console.log(chalk.cyan('\n⚡ Killing conflicting processes...\n'));

  let killedCount = 0;
  let failedCount = 0;

  for (const conflict of conflicts) {
    if (conflict.user) {
      const pid = conflict.user.pid;
      const processName = conflict.user.processName;

      try {
        // Try SIGTERM first
        await execa('kill', [String(pid)]);

        // Wait a bit for graceful shutdown
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Check if still running
        try {
          await execa('kill', ['-0', String(pid)]);
          // Still running, force kill
          await execa('kill', ['-9', String(pid)]);
        } catch {
          // Process is gone, good
        }

        console.log(chalk.green(`  ✓ Killed ${processName} (PID: ${pid}) on port ${conflict.port}`));
        killedCount++;
      } catch (error) {
        console.log(
          chalk.red(`  ✗ Failed to kill ${processName} (PID: ${pid}) on port ${conflict.port}`)
        );
        debug.error('Failed to kill process', {
          pid,
          processName,
          port: conflict.port,
          error: error instanceof Error ? error.message : error,
        });
        failedCount++;
      }
    }
  }

  console.log('');

  if (failedCount > 0) {
    console.log(chalk.yellow(`⚠️  Failed to kill ${failedCount} process(es)`));
    console.log(chalk.gray('  You may need to kill them manually with elevated permissions'));
    return false;
  }

  console.log(chalk.green(`✓ Successfully killed ${killedCount} process(es)`));
  return true;
}

/**
 * Handle Docker daemon not running
 * Prompts user to start it and waits for confirmation
 */
export async function handleDockerNotRunning(): Promise<boolean> {
  console.log(chalk.yellow('\n⚠️  Docker daemon is not running\n'));
  console.log(chalk.gray('  Your configuration includes Docker processes'));
  console.log(chalk.gray('  Please start Docker Desktop or run: sudo systemctl start docker\n'));

  const response = await prompts({
    type: 'confirm',
    name: 'retry',
    message: 'Have you started Docker? Ready to continue?',
    initial: false,
  });

  // User cancelled
  if (response.retry === undefined) {
    console.log(chalk.yellow('\n✗ Setup cancelled'));
    return false;
  }

  // User chose not to continue
  if (!response.retry) {
    console.log(chalk.yellow('\n✗ Cannot continue without Docker'));
    return false;
  }

  // Check again
  console.log(chalk.cyan('\n⚡ Checking Docker status...\n'));

  const isRunning = await isDockerRunning();

  if (isRunning) {
    console.log(chalk.green('✓ Docker is now running'));
    return true;
  } else {
    console.log(chalk.red('✗ Docker is still not running'));
    console.log(chalk.gray('  Please start Docker and try again'));
    return false;
  }
}

/**
 * Kill a process by PID
 */
export async function killProcess(pid: number, force: boolean = false): Promise<boolean> {
  try {
    if (force) {
      await execa('kill', ['-9', String(pid)]);
    } else {
      await execa('kill', [String(pid)]);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a process is running by PID
 */
export async function isProcessRunning(pid: number): Promise<boolean> {
  try {
    // kill -0 checks if process exists without actually killing it
    await execa('kill', ['-0', String(pid)]);
    return true;
  } catch {
    return false;
  }
}
