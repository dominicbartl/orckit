#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, ConfigError } from './config/load.js';
import type { OrckitConfig } from './config/schema.js';
import { BootFailedError, Orckit } from './orchestrator/orchestrator.js';
import { removeDockerContainer } from './orchestrator/docker.js';
import {
  collectExpectedPorts,
  findBlockedPorts,
  isContainerProxy,
  type BlockedPort,
} from './util/blocked-ports.js';
import { freePort } from './util/port.js';
import { attachSessionTracker } from './reporter/session-tracker.js';
import {
  clearSession,
  findSurvivors,
  isAlive,
  killSurvivor,
  readSession,
  survivorSize,
} from './util/session-state.js';
import { attachCliReporter, printFailureDump, renderStatus } from './reporter/cli-reporter.js';
import { attachShutdownReporter } from './reporter/shutdown-reporter.js';
import { attachLogReporter, type LogReporterHandle } from './reporter/log-reporter.js';
import { attachMcpServer, type McpServerHandle } from './mcp/server.js';
import { attachWebUi, type WebUiServerHandle } from './web/server.js';
import { detectIde } from './web/ide.js';
import { attachRepl, type Repl } from './reporter/repl.js';
import { renderGraph } from './reporter/graph-view.js';
import { attachDashboard, type DashboardHandle, type DashboardLink } from './reporter/dashboard.js';
import { buildGraph, filterToTargets } from './graph/resolver.js';

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
  .option(
    '--kill-blocked-ports',
    'kill whatever is listening on a required port at boot, without asking',
    false,
  )
  .option(
    '--fail-on-blocked-ports',
    'abort the boot when a required port is already in use (never prompt, never kill)',
    false,
  )
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
        killBlockedPorts: boolean;
        failOnBlockedPorts: boolean;
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

      // Before binding anything: is a required port still held by a leftover
      // process (a previous unclean shutdown, a stale `orc start`)? Depending
      // on flags/TTY this kills the holder, asks, or aborts — all better than
      // the old behavior of failing halfway through the boot.
      if (opts.killBlockedPorts && opts.failOnBlockedPorts) {
        fail(new Error('--kill-blocked-ports and --fail-on-blocked-ports are mutually exclusive'));
      }
      const requiredNames =
        targets && targets.length > 0
          ? [...filterToTargets(buildGraph(config), targets)]
          : Object.entries(config.processes)
              .filter(([, p]) => !p.optional)
              .map(([n]) => n);
      const blockedPortMode: 'ask' | 'kill' | 'fail' = opts.killBlockedPorts
        ? 'kill'
        : opts.failOnBlockedPorts
          ? 'fail'
          : process.stdin.isTTY
            ? 'ask'
            : 'fail';
      // A previous `orc start` that was SIGKILLed (force quit, OOM) had no
      // chance to run any teardown — its detached process groups are still
      // out there. The session file it left behind is how we find them.
      const stateDir = dirname(resolve(opts.config)) + '/.orckit';
      await reapPreviousSession(stateDir, blockedPortMode);
      await resolveBlockedPorts(config, requiredNames, blockedPortMode);

      // Links collected here flow into the dashboard header so they live
      // inside the persistent live region instead of scrolling away as
      // pre-boot chatter. In plain mode we print them as lines below.
      const links: DashboardLink[] = [];

      const sessionTracker = attachSessionTracker(orckit, { dir: stateDir });

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
          ? detectIde(dirname(resolve(opts.config)), { command: config.ide.command })
          : null;
        try {
          webServer = await attachWebUi(orckit, {
            port: cliWebPort ?? config.web.port,
            host: config.web.host,
            ide,
          });
          // Web dashboard is the headline action surface — show it first.
          links.unshift({ label: 'web', value: webServer.url });
          if (ide) links.push({ label: 'ide', value: `file links open via \`${ide.command}\`` });
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

      // The children are spawned detached (they never see the terminal's
      // Ctrl-C), so orckit's own teardown is the ONLY thing that can stop
      // them. Everything below is built around one invariant: this process
      // must not exit while a child it spawned is still alive.

      // After a SIGHUP (terminal closed) stdout/stderr are gone; without these
      // guards the first console.log during teardown would throw EPIPE/EIO and
      // crash the process mid-shutdown.
      process.stdout.on('error', () => {});
      process.stderr.on('error', () => {});

      // Single-flight shutdown: signals, boot failures, REPL `q` and crash
      // handlers all funnel here. Re-entry returns the in-flight promise —
      // only a REAL second signal from the user escalates to a forced exit.
      let shutdownPromise: Promise<void> | null = null;
      const shutdown = (reason: string, code = 0): Promise<void> => {
        if (shutdownPromise) return shutdownPromise;
        shutdownPromise = (async () => {
          // Watchdog: if the graceful teardown ever wedges (a pipe that won't
          // close, a hook that ignores its timeout), reap everything we can
          // reach and exit anyway rather than hanging forever with children
          // alive. unref'd so it never keeps a clean shutdown from exiting.
          const watchdog = setTimeout(() => {
            orckit.emergencyKill();
            process.exit(code || 1);
          }, 120_000);
          watchdog.unref();
          dashboard?.dispose();
          repl?.detach();
          // Swap the live reporter for the verbose shutdown reporter so teardown
          // logs which process is stopping, whether it stopped or timed out, and
          // pipes each process's + hook's output as it drains.
          detachReporter();
          attachShutdownReporter(orckit);
          console.log(chalk.yellow(`\n  received ${reason}, stopping...`));
          console.log(
            chalk.dim('  (graceful shutdown — press Ctrl-C again to force-quit immediately)'),
          );
          try {
            await orckit.dispose();
          } catch (err) {
            // A teardown error must never abort the teardown of everything
            // else — sweep what's left the hard way and still exit cleanly.
            console.error(chalk.red(`  error during shutdown: ${(err as Error).message}`));
            orckit.emergencyKill();
          }
          // Only after dispose(): the file must survive right up until the
          // children are actually gone, so a kill -9 mid-shutdown still
          // leaves a record for the next boot to clean up.
          sessionTracker.dispose();
          await logReporter?.dispose().catch(() => {});
          await mcpServer?.dispose().catch(() => {});
          await webServer?.dispose().catch(() => {});
          console.log(renderStatus(orckit.states()));
          process.exit(code);
        })();
        return shutdownPromise;
      };
      const onSignal = (signal: NodeJS.Signals) => {
        if (shutdownPromise) {
          // User hit Ctrl-C (or sent another signal) while we were shutting
          // down gracefully. Stop waiting on slow processes: SIGKILL whatever
          // is still alive, then exit hard.
          console.log(
            chalk.red(`\n  forcing exit on second ${signal} — force-killing remaining processes`),
          );
          orckit.emergencyKill();
          process.exit(130);
        }
        void shutdown(signal);
      };
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
      // Terminal window closed. Without this the process dies with no teardown
      // and every detached child is orphaned.
      process.on('SIGHUP', onSignal);
      // A crash anywhere (a listener throwing inside an emit, an unhandled
      // rejection) would otherwise kill orckit with zero teardown. The
      // synchronous kill sweep guarantees children never outlive a crash.
      const onCrash = (err: unknown) => {
        console.error(
          chalk.red(
            `\n  fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
          ),
        );
        orckit.emergencyKill();
        process.exit(1);
      };
      process.on('uncaughtException', onCrash);
      process.on('unhandledRejection', onCrash);

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
          // Single-flight: if a signal already started the teardown, this
          // awaits it instead of re-entering (which used to hard-exit
          // mid-dispose and orphan everything still stopping).
          await shutdown('boot failure', 1);
          return;
        }
        // Any other error mid-boot (preflight failure, listener throw): part
        // of the environment may already be running — tear it down instead of
        // exiting over live children.
        dashboard?.dispose();
        console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
        await shutdown('boot error', 1);
        return;
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

/**
 * Boot-time port-conflict resolution. Scans every port the upcoming boot needs
 * (ready-check endpoints, declared `ports`, orckit's own mcp/web listeners)
 * and, for each one already held: shows the holder (pid, start time, command)
 * and — depending on `mode` — kills it, asks the user (Y/n, default yes), or
 * aborts. Ports still blocked afterwards abort the boot before anything spawns.
 */
async function resolveBlockedPorts(
  config: OrckitConfig,
  names: string[],
  mode: 'ask' | 'kill' | 'fail',
): Promise<void> {
  // Leftover containers of `type: docker` processes first: their published
  // ports show up as held by the container platform's VM proxy, which must
  // never be killed — removing the container is the correct fix (and happens
  // again pre-spawn anyway; this is idempotent).
  for (const name of names) {
    const processConfig = config.processes[name];
    if (processConfig) await removeDockerContainer(processConfig);
  }

  const expected = collectExpectedPorts(config, names);
  let blocked = await findBlockedPorts(expected);
  // A container platform tears its port forwards down asynchronously: right
  // after `docker rm -f` the proxy can still be listening for a moment. Give
  // proxy-held ports a beat to settle before calling them blocked, or we'd
  // report a conflict that resolves itself milliseconds later.
  if (blocked.some((b) => b.holders.every((h) => isContainerProxy(h.command)))) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && blocked.length > 0) {
      await new Promise((r) => setTimeout(r, 250));
      blocked = await findBlockedPorts(expected);
      if (!blocked.some((b) => b.holders.every((h) => isContainerProxy(h.command)))) break;
    }
  }
  if (blocked.length === 0) return;

  console.log(chalk.yellow(`\n  ${blocked.length} port(s) orckit wants are already in use`));
  const unresolved: BlockedPort[] = [];
  for (const bp of blocked) {
    const needs = bp.owner === 'orckit' ? `orckit's ${bp.source} server` : `process "${bp.owner}"`;
    console.log(`\n  port ${chalk.bold(String(bp.port))} — needed by ${needs}, held by:`);
    for (const h of bp.holders) {
      const since = h.startedAt ? chalk.dim(` (since ${h.startedAt})`) : '';
      console.log(`    pid ${chalk.bold(String(h.pid))}${since}  ${h.command}`);
    }

    if (bp.holders.every((h) => isContainerProxy(h.command))) {
      console.log(
        chalk.yellow(
          `    ↳ this is a container platform's port proxy — killing it would hit the VM\n` +
            `      manager, not the workload. Remove the container publishing :${bp.port}\n` +
            `      (\`docker ps\`) and retry.`,
        ),
      );
      unresolved.push(bp);
      continue;
    }

    // Never auto-kill for orckit's own mcp/web ports: the likeliest holder is
    // another project's `orc start`, and taking down someone's whole dev
    // environment to free a dashboard port is never the right trade.
    if (!bp.required) {
      unresolved.push(bp);
      continue;
    }

    let kill = mode === 'kill';
    if (mode === 'ask') {
      kill = await confirm(`    kill ${bp.holders.length > 1 ? 'them' : 'it'}? [Y/n] `);
    }
    if (!kill) {
      unresolved.push(bp);
      continue;
    }
    // Generous SIGTERM grace: the holder may be a stale `orc start`, whose
    // SIGTERM handler tears its own children down gracefully — SIGKILLing it
    // early would orphan THEM.
    const freed = await freePort(bp.port, 15_000);
    if (freed) {
      console.log(chalk.green(`    ✓ port ${bp.port} freed`));
    } else {
      console.log(chalk.red(`    ✗ port ${bp.port} is still in use`));
      unresolved.push(bp);
    }
  }

  // orckit's own mcp/web listeners are conveniences, not prerequisites — the
  // CLI already warns and carries on when one can't bind. Aborting over them
  // would mean a second project's `orc start` fails purely because the first
  // one is running.
  const optional = unresolved.filter((b) => !b.required);
  if (optional.length > 0) {
    for (const b of optional) {
      console.log(
        chalk.yellow(
          `  ↳ :${b.port} stays in use — orckit's ${b.source} server won't start (boot continues)`,
        ),
      );
    }
  }

  const required = unresolved.filter((b) => b.required);
  if (required.length > 0) {
    const ports = required.map((b) => b.port).join(', ');
    const hint = mode === 'ask' ? ' (pass --kill-blocked-ports to skip the prompt next time)' : '';
    fail(new Error(`cannot start: port(s) ${ports} still in use${hint}`));
  }
}

/**
 * Detect and clean up a previous `orc start` that died without tearing its
 * children down (only possible via SIGKILL / force quit / OOM — every other
 * path runs teardown). Uses the same mode as the blocked-port check: kill,
 * ask, or fail. A stale session file with no live survivors is just deleted.
 */
async function reapPreviousSession(stateDir: string, mode: 'ask' | 'kill' | 'fail'): Promise<void> {
  const session = readSession(stateDir);
  if (!session) return;
  // Another `orc start` is running right now against this config — its
  // processes are not orphans, and the port check will flag any real conflict.
  if (session.orckitPid !== process.pid && isAlive(session.orckitPid)) return;

  const survivors = await findSurvivors(session);
  if (survivors.length === 0) {
    clearSession(stateDir);
    return;
  }

  const liveCount = survivors.reduce((n, s) => n + survivorSize(s), 0);
  console.log(
    chalk.yellow(
      `\n  a previous orckit session did not shut down cleanly — ` +
        `${survivors.length} process(es) from it are still running` +
        (liveCount > survivors.length ? ` (${liveCount} including their children)` : ''),
    ),
  );
  for (const s of survivors) {
    const extra = survivorSize(s) - 1;
    const withKids = extra > 0 ? chalk.dim(` +${extra} child${extra === 1 ? '' : 'ren'}`) : '';
    console.log(
      `    ${chalk.bold(s.name)} ${chalk.dim(`(pid ${s.pid})`)}${withKids}  ${s.command}`,
    );
  }

  if (mode === 'fail') {
    fail(
      new Error(
        'refusing to start on top of a previous session — stop those processes, ' +
          'or pass --kill-blocked-ports to have orckit clean them up',
      ),
    );
  }
  const kill = mode === 'kill' || (await confirm('    kill them? [Y/n] '));
  if (!kill) {
    fail(new Error('previous session still running — not starting'));
  }

  const failed: string[] = [];
  for (const s of survivors) {
    if (await killSurvivor(s)) {
      console.log(chalk.green(`    ✓ ${s.name} (pid ${s.pid}) stopped`));
    } else {
      failed.push(`${s.name} (pid ${s.pid})`);
    }
  }
  if (failed.length > 0) {
    fail(new Error(`could not stop leftover process(es): ${failed.join(', ')}`));
  }
  clearSession(stateDir);
}

/** One-line Y/n question on the terminal; empty answer counts as yes. */
function confirm(question: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolvePromise(a === '' || a === 'y' || a === 'yes');
    });
  });
}

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
