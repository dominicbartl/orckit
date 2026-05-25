#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, ConfigError } from './config/load.js';
import { BootFailedError, Orckit } from './orchestrator/orchestrator.js';
import { attachCliReporter, renderStatus } from './reporter/cli-reporter.js';
import { attachLogReporter, type LogReporterHandle } from './reporter/log-reporter.js';
import { attachRepl, type Repl } from './reporter/repl.js';
import { attachMcpServer, type McpServerHandle } from './mcp/server.js';
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
  .option('--no-repl', 'disable the interactive command prompt')
  .option('--mcp-port <port>', 'override the YAML mcp.port (must be enabled in config)')
  .option('--no-mcp', 'force-disable the built-in MCP server, overriding YAML')
  .action(
    async (
      processes: string[],
      opts: {
        config: string;
        showOutput: boolean;
        showBuild: boolean;
        repl: boolean;
        mcp: boolean;
        mcpPort?: string;
      },
    ) => {
      const config = loadConfig(opts.config);
      const orckit = new Orckit(config);

      let repl: Repl | null = null;
      attachCliReporter(orckit, {
        showOutput: opts.showOutput,
        showBuild: opts.showBuild,
        printHint: (msg) => (repl ? repl.printHint(msg) : console.log('\n' + msg)),
      });

      let logReporter: LogReporterHandle | null = null;
      if (config.logs.enabled) {
        logReporter = attachLogReporter(orckit, { dir: config.logs.dir });
        console.log(chalk.dim(`  writing logs to ${logReporter.dir}`));
      }

      const cliMcpEnabled = opts.mcp !== false;
      const cliMcpPort = opts.mcpPort != null ? Number(opts.mcpPort) : undefined;
      if (cliMcpPort != null && Number.isNaN(cliMcpPort)) {
        fail(new Error(`--mcp-port must be a number, got "${opts.mcpPort}"`));
      }
      let mcpServer: McpServerHandle | null = null;
      if (cliMcpPort != null && !config.mcp.enabled) {
        console.warn(
          chalk.yellow(
            '  --mcp-port was given but mcp.enabled is false in config; not starting MCP server',
          ),
        );
      } else if (cliMcpEnabled && config.mcp.enabled) {
        try {
          mcpServer = await attachMcpServer(orckit, {
            port: cliMcpPort ?? config.mcp.port,
            host: config.mcp.host,
          });
          console.log(chalk.dim(`  mcp:  ${mcpServer.url}`));
          console.log(chalk.dim(`        claude mcp add --transport http orckit ${mcpServer.url}`));
        } catch (err) {
          console.error(chalk.yellow(`  mcp server failed to start: ${(err as Error).message}`));
          console.error(
            chalk.dim(
              '  (continuing without MCP; set mcp.enabled: false in config or pass --no-mcp to silence)',
            ),
          );
        }
      }

      let shuttingDown = false;
      const shutdown = async (signal: string, code = 0) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(chalk.yellow(`\n  received ${signal}, stopping...`));
        repl?.detach();
        await orckit.dispose();
        await logReporter?.dispose();
        await mcpServer?.dispose();
        console.log(renderStatus(orckit.states()));
        process.exit(code);
      };
      process.on('SIGINT', () => void shutdown('SIGINT'));
      process.on('SIGTERM', () => void shutdown('SIGTERM'));

      const targets = processes.length > 0 ? processes : undefined;
      try {
        await orckit.start(targets);
      } catch (err) {
        if (err instanceof BootFailedError) {
          console.error(chalk.red(`\n  ✗ boot failed: ${err.strictFailures.join(', ')}`));
          console.error(
            chalk.dim(
              '    (mark these processes `manual_retry: true` in the config to opt into\n' +
                '    fix-and-retry behavior instead of aborting on failure)',
            ),
          );
          await shutdown('boot failure', 1);
          return;
        }
        fail(err);
      }

      if (opts.repl) {
        repl = attachRepl({
          retry: async (givenTargets, cascade) => {
            const states = orckit.states();
            const failed = [...states].filter(([, s]) => s === 'failed').map(([n]) => n);
            const targets = givenTargets.length > 0 ? givenTargets : failed;
            if (targets.length === 0) {
              console.log(chalk.dim('  nothing to retry'));
              return;
            }
            for (const name of targets) {
              if (!states.has(name)) {
                console.log(chalk.yellow(`  unknown process "${name}"`));
                return;
              }
            }
            await orckit.restart(targets, { cascade });
          },
          status: () => {
            console.log('');
            console.log(renderStatus(orckit.states()));
          },
          quit: () => shutdown('user quit'),
        });
      }

      await new Promise(() => {
        /* keep alive until signal */
      });
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
