#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, ConfigError } from './config/load.js';
import { Orckit } from './orchestrator/orchestrator.js';
import { attachCliReporter, renderStatus } from './reporter/cli-reporter.js';
import { buildGraph, visualize } from './graph/resolver.js';

const program = new Command()
  .name('orc')
  .description('Lean CLI process orchestrator')
  .version('0.2.0');

program
  .command('validate')
  .description('Validate a configuration file and print the resolved dependency order')
  .option('-c, --config <path>', 'config file path', './orckit.yaml')
  .action((opts: { config: string }) => {
    try {
      const config = loadConfig(opts.config);
      console.log(chalk.green('✓ configuration valid'));
      console.log(chalk.bold('\nDependency graph:'));
      const graph = buildGraph(config);
      console.log(
        visualize(graph)
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n'),
      );
    } catch (err) {
      fail(err);
    }
  });

program
  .command('list')
  .description('List processes defined in the configuration')
  .option('-c, --config <path>', 'config file path', './orckit.yaml')
  .action((opts: { config: string }) => {
    try {
      const config = loadConfig(opts.config);
      console.log(chalk.bold(`Processes for ${config.project}:`));
      for (const [name, processConfig] of Object.entries(config.processes)) {
        console.log(`  ${chalk.cyan(name)} ${chalk.dim(`(${processConfig.type})`)}`);
        console.log(`    command: ${processConfig.command}`);
        if (processConfig.depends_on.length > 0) {
          console.log(`    deps:    ${processConfig.depends_on.join(', ')}`);
        }
      }
    } catch (err) {
      fail(err);
    }
  });

program
  .command('start [processes...]')
  .description('Start all processes (or only the listed ones plus their dependencies)')
  .option('-c, --config <path>', 'config file path', './orckit.yaml')
  .option('--show-output', 'stream process stdout/stderr to terminal', false)
  .option('--show-build', 'show build events (webpack/angular)', false)
  .action(
    async (
      processes: string[],
      opts: { config: string; showOutput: boolean; showBuild: boolean },
    ) => {
      try {
        const config = loadConfig(opts.config);
        const orckit = new Orckit(config);
        attachCliReporter(orckit, { showOutput: opts.showOutput, showBuild: opts.showBuild });

        const targets = processes.length > 0 ? processes : undefined;
        await orckit.start(targets);

        let shuttingDown = false;
        const shutdown = async (signal: string) => {
          if (shuttingDown) return;
          shuttingDown = true;
          console.log(chalk.yellow(`\n  received ${signal}, stopping...`));
          await orckit.dispose();
          console.log(renderStatus(orckit.states()));
          process.exit(0);
        };
        process.on('SIGINT', () => void shutdown('SIGINT'));
        process.on('SIGTERM', () => void shutdown('SIGTERM'));

        await new Promise(() => {
          /* keep alive until signal */
        });
      } catch (err) {
        fail(err);
      }
    },
  );

program.parseAsync().catch(fail);

function fail(err: unknown): never {
  if (err instanceof ConfigError) {
    console.error(chalk.red(`✗ ${err.message}`));
  } else if (err instanceof Error) {
    console.error(chalk.red(`✗ ${err.message}`));
  } else {
    console.error(chalk.red('✗ unexpected error'), err);
  }
  process.exit(1);
}
