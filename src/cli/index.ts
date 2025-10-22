#!/usr/bin/env node

/**
 * Orckit CLI entry point
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { Orckit } from '../core/orckit.js';
import { parseConfig } from '../core/config/parser.js';
import { resolveDependencies, visualizeDependencyGraph } from '../core/dependency/resolver.js';

const program = new Command();

program
  .name('orc')
  .description('Process orchestration tool for local development environments')
  .version('0.1.0');

/**
 * Start command
 */
program
  .command('start [processes...]')
  .description('Start all processes or specific processes')
  .option('-c, --config <path>', 'Path to configuration file', './orckit.yaml')
  .action(async (processes: string[], options: { config: string }) => {
    try {
      console.log(chalk.cyan('🎭 Orckit - Starting processes...\n'));

      const orckit = new Orckit({ configPath: options.config });

      // Listen to events
      orckit.on('process:starting', (event: { processName: string }) => {
        console.log(chalk.yellow(`  ⚙  Starting ${event.processName}...`));
      });

      orckit.on('process:ready', (event: { processName: string; duration: number }) => {
        console.log(chalk.green(`  ✓  ${event.processName} ready (${event.duration}ms)`));
      });

      orckit.on('all:ready', () => {
        console.log(chalk.green('\n✓  All processes started successfully!\n'));
      });

      await orckit.start(processes.length > 0 ? processes : undefined);
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
 * Attach command (placeholder)
 */
program
  .command('attach <process>')
  .description('Attach to a process tmux pane')
  .option('-c, --config <path>', 'Path to configuration file', './orckit.yaml')
  .action((process: string, _options: { config: string }) => {
    console.log(chalk.yellow(`Attaching to ${process} (not yet implemented)`));
    // TODO: Implement tmux attach
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
