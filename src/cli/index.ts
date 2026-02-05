#!/usr/bin/env node

/**
 * Orckit CLI entry point
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { Orckit } from '../core/orckit.js';
import { parseConfig } from '../core/config/parser.js';
import { resolveDependencies, visualizeDependencyGraph } from '../core/dependency/resolver.js';
import { initializeDebugLogging, debugConfig, LogLevel } from '../utils/logger.js';

const program = new Command();

program
  .name('orc')
  .description('Process orchestration tool for local development environments')
  .version('0.1.0')
  .option('-d, --debug', 'Enable debug logging')
  .option('--log-level <level>', 'Set log level (DEBUG, INFO, WARN, ERROR)', 'INFO')
  .option('--process-debug', 'Print process stdout/stderr to terminal')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();

    // Enable debug logging if --debug flag is provided or ORCKIT_DEBUG env is set
    if (opts.debug || process.env.ORCKIT_DEBUG || process.env.DEBUG) {
      debugConfig.setEnabled(true);
    }

    // Set log level
    const levelStr = opts.logLevel?.toUpperCase() || process.env.ORCKIT_LOG_LEVEL?.toUpperCase() || 'INFO';
    switch (levelStr) {
      case 'DEBUG':
        debugConfig.setLevel(LogLevel.DEBUG);
        break;
      case 'INFO':
        debugConfig.setLevel(LogLevel.INFO);
        break;
      case 'WARN':
        debugConfig.setLevel(LogLevel.WARN);
        break;
      case 'ERROR':
        debugConfig.setLevel(LogLevel.ERROR);
        break;
      default:
        debugConfig.setLevel(LogLevel.INFO);
    }

    // Initialize debug logging from environment
    initializeDebugLogging();
  });

/**
 * Start command
 */
program
  .command('start [processes...]')
  .description('Start all processes or specific processes')
  .option('-c, --config <path>', 'Path to configuration file', './orckit.yaml')
  .option('--headless', 'Run without UI (background mode)', false)
  .action(async (processes: string[], options: { config: string; headless: boolean }) => {
    try {
      console.log(chalk.cyan('🎭 Orckit - Starting processes...\n'));

      // Get global options
      const globalOpts = program.opts();

      const orckit = new Orckit({
        configPath: options.config,
        processDebug: globalOpts.processDebug ?? false,
        headless: options.headless,
      });

      // Listen to all process lifecycle events
      orckit.on('process:starting', (event: { processName: string; timestamp: Date }) => {
        console.log(chalk.yellow(`  ⚙  Starting ${event.processName}...`));
      });

      orckit.on('process:ready', (event: { processName: string; timestamp: Date }) => {
        const duration = Date.now() - event.timestamp.getTime();
        console.log(chalk.green(`  ✓  ${event.processName} ready (${duration}ms)`));
      });

      orckit.on('process:status', (event: { processName: string; status: string }) => {
        const statusColor =
          event.status === 'running' ? chalk.green :
          event.status === 'building' ? chalk.cyan :
          event.status === 'failed' ? chalk.red :
          event.status === 'stopped' ? chalk.gray :
          chalk.yellow;
        console.log(statusColor(`  →  ${event.processName}: ${event.status}`));
      });

      orckit.on('process:failed', (event: { processName: string; error: Error }) => {
        console.log(chalk.red(`  ✗  ${event.processName} failed: ${event.error.message}`));
      });

      orckit.on('process:stopped', (event: { processName: string; timestamp: Date }) => {
        console.log(chalk.gray(`  ⏹  ${event.processName} stopped`));
      });

      orckit.on('process:restarting', (event: { processName: string; restartCount: number }) => {
        console.log(chalk.yellow(`  ↻  ${event.processName} restarting (attempt ${event.restartCount})...`));
      });

      orckit.on('all:ready', () => {
        console.log(chalk.green('\n✓  All processes started successfully!\n'));
      });

      // Listen to build events (for webpack, angular, etc.)
      orckit.on('build:progress', (event: { processName: string; progress: number }) => {
        console.log(chalk.cyan(`  🔨 ${event.processName}: Building... ${event.progress}%`));
      });

      orckit.on('build:stats', (event: { processName: string; errors: number; warnings: number }) => {
        if (event.errors > 0) {
          console.log(chalk.red(`  ⚠  ${event.processName}: ${event.errors} error(s), ${event.warnings} warning(s)`));
        } else if (event.warnings > 0) {
          console.log(chalk.yellow(`  ⚠  ${event.processName}: ${event.warnings} warning(s)`));
        } else {
          console.log(chalk.green(`  ✓  ${event.processName}: Build successful`));
        }
      });

      await orckit.start(processes.length > 0 ? processes : undefined);

      // Keep process alive
      console.log(chalk.green('\n✓  Orckit is running'));
      console.log(chalk.cyan('  View status: orc status\n'));

      await new Promise(() => {
        /* never resolves */
      });
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * Stop command
 */
program
  .command('stop [processes...]')
  .description('Stop processes')
  .option('-c, --config <path>', 'Path to configuration file', './orckit.yaml')
  .action(async (processes: string[], options: { config: string }) => {
    try {
      console.log(chalk.cyan('Stopping processes...\n'));

      const orckit = new Orckit({ configPath: options.config });
      await orckit.stop(processes.length > 0 ? processes : undefined);

      console.log(chalk.green('✓  Processes stopped\n'));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * Restart command
 */
program
  .command('restart <processes...>')
  .description('Restart processes')
  .option('-c, --config <path>', 'Path to configuration file', './orckit.yaml')
  .action(async (processes: string[], options: { config: string }) => {
    try {
      console.log(chalk.cyan('Restarting processes...\n'));

      const orckit = new Orckit({ configPath: options.config });
      await orckit.restart(processes);

      console.log(chalk.green('✓  Processes restarted\n'));
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * Status command
 */
program
  .command('status')
  .description('Show status of all processes')
  .option('-c, --config <path>', 'Path to configuration file', './orckit.yaml')
  .action((options: { config: string }) => {
    try {
      const orckit = new Orckit({ configPath: options.config });
      const statuses = orckit.getStatus() as Map<string, string>;

      console.log(chalk.cyan('\n📊 Process Status:\n'));

      for (const [name, status] of statuses.entries()) {
        const icon = status === 'running' ? '🟢' : status === 'failed' ? '🔴' : '⚪';
        console.log(`  ${icon} ${name.padEnd(20)} ${status}`);
      }

      console.log();
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * List command
 */
program
  .command('list')
  .description('List all defined processes')
  .option('-c, --config <path>', 'Path to configuration file', './orckit.yaml')
  .action((options: { config: string }) => {
    try {
      const config = parseConfig(options.config);

      console.log(chalk.cyan('\n📋 Defined Processes:\n'));

      for (const [name, processConfig] of Object.entries(config.processes)) {
        console.log(`  ${chalk.bold(name)}`);
        console.log(`    Category: ${processConfig.category}`);
        console.log(`    Type: ${processConfig.type ?? 'bash'}`);
        console.log(`    Command: ${processConfig.command}`);

        if (processConfig.dependencies && processConfig.dependencies.length > 0) {
          console.log(`    Dependencies: ${processConfig.dependencies.join(', ')}`);
        }

        console.log();
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * Validate command
 */
program
  .command('validate')
  .description('Validate configuration file')
  .option('-c, --config <path>', 'Path to configuration file', './orckit.yaml')
  .action((options: { config: string }) => {
    try {
      const config = parseConfig(options.config);

      console.log(chalk.green('✓  Configuration is valid\n'));

      // Show dependency order
      const order = resolveDependencies(config);
      console.log(chalk.cyan('Startup order:'));
      console.log(`  ${order.join(' → ')}\n`);

      // Show dependency graph
      console.log(chalk.cyan('Dependency graph:'));
      const graph = visualizeDependencyGraph(config);
      console.log(
        graph
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n')
      );
      console.log();
    } catch (error) {
      console.error(chalk.red('✗  Configuration validation failed\n'));
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

/**
 * Logs command (placeholder)
 */
program
  .command('logs <process>')
  .description('View logs for a process')
  .option('-f, --follow', 'Follow log output')
  .option('-c, --config <path>', 'Path to configuration file', './orckit.yaml')
  .action((process: string, _options: { follow?: boolean; config: string }) => {
    console.log(chalk.yellow(`Logs for ${process} (not yet implemented)`));
    // TODO: Implement log viewing
  });

/**
 * Completion command (placeholder)
 */
program
  .command('completion')
  .description('Generate shell completion script')
  .action(() => {
    console.log(chalk.yellow('Shell completion (not yet implemented)'));
    // TODO: Implement with omelette
  });

program.parse();
