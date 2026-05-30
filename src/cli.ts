#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, ConfigError } from './config/load.js';
import { BootFailedError, Orckit } from './orchestrator/orchestrator.js';
import { attachCliReporter, printFailureDump, renderStatus } from './reporter/cli-reporter.js';
import { attachShutdownReporter } from './reporter/shutdown-reporter.js';
import { attachLogReporter, type LogReporterHandle } from './reporter/log-reporter.js';
import { attachMcpServer, type McpServerHandle } from './mcp/server.js';
import { attachWebUi, type WebUiServerHandle } from './web/server.js';
import { detectIde } from './web/ide.js';
import { attachRepl, type Repl } from './reporter/repl.js';
import { renderGraph } from './reporter/graph-view.js';
import { attachDashboard, type DashboardHandle, type DashboardLink } from './reporter/dashboard.js';
import { buildGraph } from './graph/resolver.js';

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
      console.log(chalk.bold('\nDependency graph'));
      const graph = buildGraph(config);
      console.log(
        renderGraph(graph)
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
  .option('--show-output', 'stream process stdout/stderr to terminal (above the dashboard)', false)
  .option('--show-build', 'show raw build events as they happen', false)
  .option('--no-repl', 'disable the interactive command prompt (plain mode only)')
  .option('--no-live', 'disable the persistent dashboard (use plain line-by-line output)')
  .option(
    '-w, --with <name>',
    'additionally start an optional process (repeatable: -w a -w b)',
    (value: string, prev: string[] = []) => prev.concat(value),
    [] as string[],
  )
  .option('--mcp-port <port>', 'override the YAML mcp.port (must be enabled in config)')
  .option('--no-mcp', 'force-disable the built-in MCP server, overriding YAML')
  .option('--web-port <port>', 'override the YAML web.port (must be enabled in config)')
  .option('--no-web', 'force-disable the built-in web dashboard, overriding YAML')
  .action(
    async (
      processes: string[],
      opts: {
        config: string;
        showOutput: boolean;
        showBuild: boolean;
        repl: boolean;
        live: boolean;
        with: string[];
        mcp: boolean;
        mcpPort?: string;
        web: boolean;
        webPort?: string;
      },
    ) => {
      const config = loadConfig(opts.config);
      const orckit = new Orckit(config);

      // Capture each process's failure message so the boot-failure dump can
      // show *why* something died — by the time we shut down, the inline
      // failure tail may have scrolled off and a pre-spawn failure won't
      // have any buffered output at all. Keep the FIRST error per attempt
      // (a spawn ENOENT is more useful than the synthetic "exited (code ?)"
      // that follows it); clear on restart so a fresh attempt starts clean.
      const lastErrors = new Map<string, string>();
      orckit.on('process:failed', (name, err) => {
        if (lastErrors.has(name)) return;
        lastErrors.set(name, err?.message ?? 'process failed');
      });
      orckit.on('process:state', (name, state) => {
        if (state === 'starting') lastErrors.delete(name);
      });

      // Links collected here flow into the dashboard header so they live
      // inside the persistent live region instead of scrolling away as
      // pre-boot chatter. In plain mode we print them as lines below.
      const links: DashboardLink[] = [];

      let logReporter: LogReporterHandle | null = null;
      if (config.logs.enabled) {
        logReporter = attachLogReporter(orckit, { dir: config.logs.dir });
        links.push({ label: 'logs', value: logReporter.dir });
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
          links.push({ label: 'mcp', value: mcpServer.url });
        } catch (err) {
          console.error(chalk.yellow(`  mcp server failed to start: ${(err as Error).message}`));
          console.error(
            chalk.dim(
              '  (continuing without MCP; set mcp.enabled: false in config or pass --no-mcp to silence)',
            ),
          );
        }
      }

      const cliWebEnabled = opts.web !== false;
      const cliWebPort = opts.webPort != null ? Number(opts.webPort) : undefined;
      if (cliWebPort != null && Number.isNaN(cliWebPort)) {
        fail(new Error(`--web-port must be a number, got "${opts.webPort}"`));
      }
      let webServer: WebUiServerHandle | null = null;
      if (cliWebPort != null && !config.web.enabled) {
        console.warn(
          chalk.yellow(
            '  --web-port was given but web.enabled is false in config; not starting web dashboard',
          ),
        );
      } else if (cliWebEnabled && config.web.enabled) {
        // Detect a JetBrains project so the dashboard can deep-link file
        // references in logs/errors. Search from the config file's directory.
        const ide = config.ide.enabled
          ? detectIde(dirname(resolve(opts.config)), {
              tool: config.ide.tool,
              project: config.ide.project,
            })
          : null;
        try {
          webServer = await attachWebUi(orckit, {
            port: cliWebPort ?? config.web.port,
            host: config.web.host,
            ide,
          });
          // Web dashboard is the headline action surface — show it first.
          links.unshift({ label: 'web', value: webServer.url });
          if (ide) links.push({ label: 'ide', value: `${ide.toolTag} · ${ide.project}` });
        } catch (err) {
          console.error(chalk.yellow(`  web dashboard failed to start: ${(err as Error).message}`));
          console.error(
            chalk.dim(
              '  (continuing without dashboard; set web.enabled: false in config or pass --no-web to silence)',
            ),
          );
        }
      }

      // Pick a UI: persistent dashboard if we have a TTY (and --no-live wasn't
      // passed), otherwise the plain line-by-line reporter + REPL. The
      // dashboard owns lifecycle rendering for the whole session; the
      // cli-reporter rides above it for preflight banners, failure tails,
      // and (optionally) raw output / build events.
      const dashboard: DashboardHandle | null =
        opts.live === false ? null : attachDashboard(orckit, { links });

      let repl: Repl | null = null;

      // Captured so the shutdown handler can swap the live reporter out for the
      // verbose shutdown reporter without double-printing stop lines.
      let detachReporter: () => void = () => {};

      if (dashboard) {
        // Links already render in the dashboard header. The browser is the
        // action surface when the dashboard is on, so the REPL stays detached.
        detachReporter = attachCliReporter(orckit, {
          showOutput: opts.showOutput,
          showBuild: opts.showBuild,
          out: dashboard.printAbove,
          quietProcessEvents: true,
          printHint: dashboard.printAbove,
        });
      } else {
        // Plain mode: print the header inline (lines, not a live region) so
        // the user still sees where the web dashboard / MCP / logs landed.
        if (logReporter) console.log(chalk.dim(`  writing logs to ${logReporter.dir}`));
        if (mcpServer) {
          console.log(chalk.dim(`  mcp:  ${mcpServer.url}`));
          console.log(chalk.dim(`        claude mcp add --transport http orckit ${mcpServer.url}`));
        }
        if (webServer) console.log(chalk.dim(`  web:  ${webServer.url}`));

        detachReporter = attachCliReporter(orckit, {
          showOutput: opts.showOutput,
          showBuild: opts.showBuild,
          printHint: (msg) => (repl ? repl.printHint(msg) : console.log('\n' + msg)),
        });
      }

      let shuttingDown = false;
      const shutdown = async (signal: string, code = 0) => {
        if (shuttingDown) {
          // User hit Ctrl-C (or sent another signal) while we were trying to
          // shut down gracefully. Stop waiting on slow processes and exit hard.
          console.log(
            chalk.red(`\n  forcing exit on second ${signal} — child processes may be orphaned`),
          );
          process.exit(130);
        }
        shuttingDown = true;
        dashboard?.dispose();
        repl?.detach();
        // Swap the live reporter for the verbose shutdown reporter so teardown
        // logs which process is stopping, whether it stopped or timed out, and
        // pipes each process's + hook's output as it drains.
        detachReporter();
        attachShutdownReporter(orckit);
        console.log(chalk.yellow(`\n  received ${signal}, stopping...`));
        console.log(
          chalk.dim('  (graceful shutdown — press Ctrl-C again to force-quit immediately)'),
        );
        await orckit.dispose();
        await logReporter?.dispose();
        await mcpServer?.dispose();
        await webServer?.dispose();
        console.log(renderStatus(orckit.states()));
        process.exit(code);
      };
      process.on('SIGINT', () => void shutdown('SIGINT'));
      process.on('SIGTERM', () => void shutdown('SIGTERM'));

      // Validate --with names eagerly so we don't spin up an MCP server / web
      // dashboard before failing.
      for (const name of opts.with) {
        if (!(name in config.processes)) {
          fail(new Error(`--with: unknown process "${name}"`));
        }
      }
      // Targeting precedence:
      //   - if positional names are given, those are the explicit targets
      //     (--with is merged in for additive convenience)
      //   - if no positional names, undefined means "default set" (skipping
      //     optionals), and --with names are appended so they boot too.
      let targets: string[] | undefined;
      if (processes.length > 0) {
        targets = [...processes, ...opts.with];
      } else if (opts.with.length > 0) {
        targets = [
          ...Object.entries(config.processes)
            .filter(([, p]) => !p.optional)
            .map(([n]) => n),
          ...opts.with,
        ];
      }
      try {
        await orckit.start(targets);
      } catch (err) {
        if (err instanceof BootFailedError) {
          dashboard?.dispose();
          console.error(chalk.red(`\n  ✗ boot failed: ${err.strictFailures.join(', ')}`));
          console.error(
            chalk.dim(
              '    (mark these processes `manual_retry: true` in the config to opt into\n' +
                '    fix-and-retry behavior instead of aborting on failure)',
            ),
          );
          printFailureDump(orckit, err.strictFailures, lastErrors);
          await shutdown('boot failure', 1);
          return;
        }
        dashboard?.dispose();
        fail(err);
      }

      // REPL is only attached in plain mode — the persistent dashboard claims
      // the bottom of the terminal, and the browser dashboard is the action
      // surface when it's on.
      if (!dashboard && opts.repl) {
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
          start: async (targets) => {
            const states = orckit.states();
            for (const name of targets) {
              if (!states.has(name)) {
                console.log(chalk.yellow(`  unknown process "${name}"`));
                return;
              }
            }
            await orckit.startTargets(targets);
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
