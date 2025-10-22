/**
 * Boot sequence logger with multiple visualization styles
 */

import chalk from 'chalk';
import { formatDuration, createProgressBar } from '../../utils/logger.js';
import type { BootLoggerStyle, PreflightCheckResult } from '../../types/index.js';

/**
 * Boot logger for visualizing startup sequence
 */
export class BootLogger {
  private style: BootLoggerStyle;
  private startTime: number;
  private totalProcesses: number = 0;
  private processesStarted: number = 0;

  constructor(style: BootLoggerStyle = 'timeline') {
    this.style = style;
    this.startTime = Date.now();
  }

  /**
   * Print boot header
   */
  printHeader(projectName?: string): void {
    if (this.style === 'quiet') return;

    const title = projectName ? `- ${projectName}` : '';
    const padding = title ? 48 - title.length : 48;

    console.log(
      chalk.cyan(
        `┌${'─'.repeat(61)}┐\n│  🎭 MAESTRO ${title.padEnd(padding)}│\n└${'─'.repeat(61)}┘\n`
      )
    );
  }

  /**
   * Print preflight checks section
   */
  printPreflightStart(): void {
    if (this.style === 'quiet') return;

    console.log(chalk.cyan('━━━ Pre-flight Checks ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  }

  /**
   * Print preflight check result
   */
  printPreflightCheck(result: PreflightCheckResult): void {
    if (this.style === 'quiet') return;

    const icon = result.passed ? chalk.green('✓') : chalk.red('✗');
    const duration = chalk.gray(`(${formatDuration(result.duration)})`);

    console.log(`  ${icon} ${result.name.padEnd(40)} ${duration}`);

    if (!result.passed && result.fixSuggestion) {
      console.log(chalk.yellow(`    Fix: ${result.fixSuggestion}`));
    }
  }

  /**
   * Print dependency graph
   */
  printDependencyGraph(graph: string, processCount: number): void {
    if (this.style === 'quiet') return;

    console.log(chalk.cyan('\n━━━ Dependency Graph ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
    console.log(
      graph
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n')
    );
    console.log(`\n  ${processCount} processes | startup order calculated\n`);
  }

  /**
   * Print processes starting header
   */
  printProcessesStart(count: number): void {
    if (this.style === 'quiet') return;

    this.totalProcesses = count;
    console.log(
      chalk.cyan('━━━ Starting Processes ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
    );
  }

  /**
   * Print process starting
   */
  printProcessStarting(processName: string, _index: number, category: string): void {
    if (this.style === 'quiet') return;

    this.processesStarted++;

    const progress = `[${this.processesStarted}/${this.totalProcesses}]`;

    if (this.style === 'timeline') {
      console.log(chalk.cyan(`  ${progress} ${chalk.bold(processName)} (${category})`));
    } else if (this.style === 'minimal') {
      console.log(chalk.yellow(`  ⚙ ${processName}`.padEnd(30) + 'starting...'));
    }
  }

  /**
   * Print hook execution
   */
  printHook(hookName: string, command: string): void {
    if (this.style === 'quiet' || this.style === 'minimal') return;

    console.log(chalk.gray(`        ⚙  Running ${hookName}: ${command.substring(0, 50)}...`));
  }

  /**
   * Print hook complete
   */
  printHookComplete(hookName: string, duration: number): void {
    if (this.style === 'quiet' || this.style === 'minimal') return;

    console.log(chalk.gray(`        ✓  ${hookName} complete (${formatDuration(duration)})`));
  }

  /**
   * Print process status update
   */
  printProcessStatus(_processName: string, message: string): void {
    if (this.style === 'quiet') return;

    if (this.style === 'timeline') {
      console.log(chalk.gray(`        ▸  ${message}`));
    }
  }

  /**
   * Print health check attempt
   */
  printHealthCheckAttempt(_processName: string, attempt: number, message: string): void{
    if (this.style === 'quiet') return;

    if (this.style === 'timeline') {
      console.log(chalk.gray(`        ⚙  Attempt ${attempt}: ${message}`));
    }
  }

  /**
   * Print build progress
   */
  printBuildProgress(_processName: string, progress: number): void {
    if (this.style === 'quiet') return;

    if (this.style === 'timeline') {
      const bar = createProgressBar(progress);
      console.log(chalk.gray(`        ▸  Progress: ${bar}  ${progress}%`));
    }
  }

  /**
   * Print process ready
   */
  printProcessReady(processName: string, duration: number, info?: string): void {
    if (this.style === 'quiet') return;

    const time = formatDuration(duration);

    if (this.style === 'timeline') {
      console.log(chalk.green(`        ✓  Ready ${info ? `| ${info} ` : ''}(${time})`));
      console.log(); // Blank line between processes
    } else if (this.style === 'minimal') {
      console.log(chalk.green(`  ✓ ${processName}`.padEnd(30) + `ready (${time})`));
    }
  }

  /**
   * Print process failed
   */
  printProcessFailed(_processName: string, error: string): void {
    if (this.style === 'quiet') return;

    console.log(chalk.red(`        ✗  Failed: ${error}\n`));
  }

  /**
   * Print completion summary
   */
  printCompletionSummary(
    successCount: number,
    failCount: number,
    urls?: string[]
  ): void {
    if (this.style === 'quiet') return;

    const totalTime = Date.now() - this.startTime;

    console.log(chalk.cyan('━'.repeat(62) + '\n'));

    if (failCount === 0) {
      console.log(chalk.green('  ✓  All processes started successfully!\n'));
    } else {
      console.log(
        chalk.yellow(`  ⚠  ${successCount} succeeded, ${failCount} failed\n`)
      );
    }

    console.log(`  Total time: ${formatDuration(totalTime)}\n`);

    if (urls && urls.length > 0) {
      console.log(chalk.cyan('  🎯 Quick Links:'));
      for (const url of urls) {
        console.log(`     • ${url}`);
      }
      console.log();
    }

    console.log(chalk.cyan('  📊 Overview dashboard ready in tmux session\n'));
    console.log(chalk.gray("  Press Ctrl+B then 0 to view overview"));
    console.log(chalk.gray("  Run 'orc attach' to connect to processes\n"));

    console.log(chalk.cyan('━'.repeat(62)));
  }

  /**
   * Print dashboard style (alternative visualization)
   */
  printDashboard(
    preflightResults: PreflightCheckResult[],
    processStatuses: Map<string, string>
  ): void {
    if (this.style !== 'dashboard') return;

    console.clear();

    console.log(
      chalk.cyan(
        `╔═══════════════════════════════════════════════════════════╗\n║  🎭 MAESTRO │ ${new Date().toLocaleTimeString()}                               ║\n╚═══════════════════════════════════════════════════════════╝\n`
      )
    );

    // Preflight status
    console.log(chalk.cyan('┌─ Pre-flight ────────────────────────┐'));
    const passedChecks = preflightResults.filter((r) => r.passed).length;
    console.log(`│ ${passedChecks}/${preflightResults.length} checks passed                   │`);
    console.log('└─────────────────────────────────────┘\n');

    // Process status
    console.log(chalk.cyan('┌─ Process Status ────────────────────┐'));
    for (const [name, status] of processStatuses.entries()) {
      const icon =
        status === 'running'
          ? chalk.green('✓')
          : status === 'failed'
            ? chalk.red('✗')
            : chalk.yellow('⚙');
      console.log(`│ ${icon} ${name.padEnd(30)} ${status.padEnd(8)} │`);
    }
    console.log('└──────────────────────────────────────┘\n');
  }
}
