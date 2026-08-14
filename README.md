<p align="center">
  <img src="https://raw.githubusercontent.com/dominicbartl/orckit/main/assets/orckit-logo.svg" alt="orckit" width="260" />
</p>

<p align="center">
  <strong>A lean CLI for orchestrating multiple processes in local development.</strong><br/>
  <sub>One YAML file. Dependency-ordered boot. Live dashboard. Browser UI. Built-in MCP server.</sub>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#live-dashboard">Live dashboard</a> ·
  <a href="#configuration-reference">Config reference</a> ·
  <a href="#mcp-server">MCP</a> ·
  <a href="#programmatic-api">API</a>
</p>

---

Think a single-binary, opinionated replacement for a handful of shell scripts plus `tmux` plus `wait-on`. Point it at a YAML file describing your processes, their dependencies, and how to know they're ready — orckit starts them in the right order, watches for failures, restarts on policy, and tears everything down cleanly on Ctrl-C.

```
  █████████   orckit
  ███████     my-app
  █████       web   http://127.0.0.1:7677
  ██          mcp   http://127.0.0.1:7676/mcp
              logs  .orckit/logs

  ┌─ Wave 1 ─── starts immediately
  │  ✓ db                       (245ms)
  │
  ├─ Wave 2 ─── after wave 1
  │  ✓ api    ← db              (1.2s)
  │  ⠋ web    ← api             building 67%
  │
  └─ Wave 3 ─── after wave 2
     ○ worker ← api

  2/4 ready  ·  1 building  ·  1 pending
```

## Install

```bash
pnpm add -D @orckit/cli
# or
npm i -D @orckit/cli
```

Requires Node 20+.

## Quick start

Create `orckit.yaml` in your project:

```yaml
project: my-app

processes:
  db:
    type: docker                           # SIGTERM the CLI, then docker rm -f the container
    container_name: my-app-db
    command: docker run --rm --name=my-app-db -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:15
    ready:
      type: tcp
      port: 5432

  api:
    command: npm run dev
    cwd: ./api
    depends_on: [db]
    ready:
      type: http
      url: http://localhost:3000/health
    hooks:
      pre_start: npm install
```

Then:

```bash
npx orc validate          # check config + print dependency graph
npx orc list              # list processes
npx orc start             # boot everything in dependency order
npx orc start api         # boot just api (and its deps)
npx orc start --show-output     # stream stdout/stderr to the terminal above the dashboard
npx orc start --no-live         # disable the persistent dashboard (plain line-by-line output)
npx orc start --mcp-port 7700   # override the YAML mcp.port
npx orc start --no-mcp          # force-disable the built-in MCP server
npx orc start --kill-blocked-ports    # free required ports without asking
npx orc start --fail-on-blocked-ports # abort if a required port is taken
```

Ctrl-C triggers graceful shutdown (SIGTERM → per-process `stop_grace_ms`, default 10s → SIGKILL).

## Shutdown and orphaned processes

Every process is spawned in its own process group. On teardown orckit takes a
snapshot of the process's **entire descendant tree first**, then signals every
process group in it — not just the root's. Both halves matter:

- Snapshotting *before* signalling is what makes escaped children reachable.
  Kill the parent first and its children instantly reparent to init, so a
  `ppid`-based walk done afterwards finds nothing and they survive forever.
- Signalling *every group in the tree* covers wrapper scripts that run
  `set -m` (bash monitor mode, extremely common in dev scripts) or `setsid`.
  Those put each job in its own process group that `kill(-pid)` never reaches —
  which is how `firebase emulators`, `docker run &` and `stripe listen` used to
  outlive a shutdown.

After the direct child exits, orckit verifies every process in that snapshot is
actually gone and escalates on the ones that aren't. Because the children are
detached they never see the terminal's Ctrl-C directly: **orckit's teardown is
the only thing that stops them**, and it is built to run in every exit path.

- **Ctrl-C at any point during boot** cancels the startup that's in flight —
  including a long `pre_start` hook — and nothing spawns behind it.
- **A second Ctrl-C** force-kills every remaining process group immediately
  (and removes `type: docker` containers) instead of waiting out grace windows.
- **SIGHUP** (you closed the terminal) tears down exactly like Ctrl-C.
- **A crash** (uncaught exception, unhandled rejection) runs a synchronous kill
  sweep before exiting, so a bug in orckit can't strand your dev environment.
- **A failing `pre_stop` / `post_stop` hook** no longer blocks the teardown of
  anything else — the kill path runs regardless.
- After teardown, orckit verifies the process's declared `ports` were actually
  released when `kill_orphan_ports` is set, and reports `process:escaped` in the
  rare case a descendant survived.

### Recovering from a force-quit

The one exit orckit cannot handle from the inside is being `SIGKILL`ed itself —
force quit, the OOM killer, `kill -9`. No handler runs, so the detached process
groups simply keep going. To make that recoverable, orckit maintains
`.orckit/session.json` (next to your config) listing the processes it spawned
*and their descendants* (re-walked every 15s), and deletes it on a clean exit.
Its presence at boot therefore means "the previous session died badly", and the
next `orc start` reports the survivors and offers to kill them, using the same
rules as blocked ports:

```
  a previous orckit session did not shut down cleanly — 3 process(es) from it are still running (17 including their children)
    webapp (pid 41196) +1 child   pnpm exec ng serve
    templates (pid 41240) +8 children  pnpm templates:start
    emulators (pid 41469) +9 children  pnpm exec firebase emulators:start
    kill them? [Y/n]
```

Descendants are tracked, not just the processes orckit spawned directly,
because the ones that actually strand themselves are usually grandchildren — a
Firebase functions runtime, an `ng serve` worker — which reparent to init the
moment their intermediate parent dies and are then unreachable from the root
PID. A recorded PID is only ever killed when the process still running under it
matches the command that was recorded, so a recycled PID is left alone. If
another `orc start` is alive and owns the file, its processes aren't treated as
orphans.

### Blocked ports at boot

Before anything spawns, orckit checks every port the boot needs — `http`/`tcp`
ready-check endpoints, each process's declared `ports`, and its own MCP/web
ports — and reports what is already listening (pid, start time, command):

```
  1 required port(s) already in use

  port 4200 — needed by process "webapp", held by:
    pid 51234 (since Thu Aug 14 09:12:03 2026)  node .../ng serve
    kill it? [Y/n]
```

On a TTY it asks (default yes). Otherwise, and with no flags, it aborts rather
than killing something unattended. Use `--kill-blocked-ports` to always kill, or
`--fail-on-blocked-ports` to always abort (the two are mutually exclusive). The
holder gets a SIGTERM with a generous grace period first — if it's a stale
`orc start`, that lets it tear down its own children — and only then a SIGKILL.
A port held by a container platform's proxy (Docker Desktop, OrbStack, colima)
is never killed: orckit tells you to remove the container publishing it, because
killing that pid would hit the VM manager instead of the workload.

## Live dashboard

When stdout is a TTY, `orc start` pins a persistent dashboard to the bottom of the terminal for the whole session. It has three regions:

- **Header** — the orckit brand mark, project name, and labelled links to the web dashboard, MCP server, and log directory (whichever are enabled).
- **Dependency graph** — wave-grouped tree with a state icon per process (`○` pending, `⠋` animated while starting, `✓` ready, `✗` failed) and elapsed time once it settles. Webpack/Angular builds annotate their row with `building 67%`, `built 1.2s`, or `build failed`.
- **Footer** — `N/total ready · N building · N starting · N failed` counters that update live.

Preflight banners, failure tails (the recent stdout/stderr dump after a process dies), and `--show-output` lines print *above* the dashboard so they stay in scrollback while the live region keeps tracking state below them.

The browser dashboard at `http://127.0.0.1:7677` is the action surface — restart and stop buttons live there. It mirrors the terminal's build annotations: webpack/angular processes carry a build badge (`building 67%`, `built 1.2s`, `build failed · 21 errors`) next to their state, so a failed recompile stays visible even while the dev server keeps running. When you run inside a JetBrains IDE (a `.idea` folder is present), file references in the logs and errors — `src/app.ts:42:10` and the like — become clickable links that jump straight to the file at that line in your already-running IDE. The browser can't open an IDE itself, so clicking POSTs to orckit, which opens the file: paths **inside the project root** (the `.idea` directory) open in your IDE via its **command-line launcher** (`webstorm --line 42 …`); paths **outside it** — temp files, generated artifacts like `/var/folders/…/mailer/x.html` — open in the OS **default application** instead. Paths are resolved to absolute against each process's working directory, so monorepo subdirectories resolve correctly. This needs no JetBrains Toolbox and no plugin — just the launcher on `PATH` (create it via the IDE's **Tools → "Create Command-Line Launcher"**). A missing/dead file or an unreachable launcher surfaces as a toast. Configure the launcher with the [`ide:` block](#configuration-reference). The terminal REPL only attaches in plain mode (`--no-live` or a non-TTY stdout).

Pass `--no-live` to skip the dashboard entirely and get plain line-by-line lifecycle output plus the REPL.

## Configuration reference

```yaml
project: my-project          # optional, used in CLI output

logs:                        # optional; off by default
  enabled: true              # default: false
  dir: .orckit/logs          # default: .orckit/logs (relative to cwd)

mcp:                         # optional; on by default
  enabled: true              # default: true
  port: 7676                 # default: 7676
  host: 127.0.0.1            # default: 127.0.0.1

ide:                         # optional; on by default. Deep-links file refs in
                             # the web dashboard's logs + errors to your IDE.
  enabled: true              # default: true. When a `.idea` folder is found at
                             #   or above the config, file references like
                             #   `src/app.ts:42:10` in the dashboard become
                             #   clickable. Clicking POSTs to orckit, which runs
                             #   the IDE's command-line launcher to open the file
                             #   at that line in your already-running IDE. No
                             #   Toolbox or plugin needed. No `.idea` → no links;
                             #   no effect on the terminal UI.
  command: webstorm          # default: webstorm. The IDE's command-line launcher
                             #   (`idea`, `pycharm`, `phpstorm`, `goland`, …).
                             #   Create it via the IDE's Tools → "Create
                             #   Command-Line Launcher", or set the full path.

preflight:                   # optional pre-startup checks (run in parallel)
  - name: docker-up
    command: docker info >/dev/null
    on_fail: start Docker Desktop

processes:
  <name>:
    type: bash | webpack | angular | docker   # default: bash
    command: <shell command>          # required
    container_name: <name>            # required when type: docker; rejected otherwise.
                                      # The container is `docker rm -f`'d both before spawn
                                      # (clears an orphan from a crashed run) and after stop
                                      # (frees its ports). Must match the `--name=` in command.
    stop_command: <shell command>     # optional; run *instead of* SIGTERM during shutdown.
                                      # Use for CLI clients managing external state that the
                                      # docker type can't express — e.g. `docker compose down`
                                      # for a `docker compose up` process. Falls back to SIGKILL
                                      # if the main process is still alive after the grace period.
                                      # `type: docker` does NOT need this.
    cwd: <path>                       # default: current dir
    category: <string>                # cosmetic grouping; default: 'default'
    env: { KEY: value }
    depends_on: [other-process-name, ...]

    ready:                            # optional; without it the process is "ready" as soon as it spawns
      type: http
      url: http://localhost:3000/health   # if the host is localhost, orckit also verifies
                                          # the port is FREE before spawn — see note below
      expected_status: 200            # default: 200
      interval_ms: 1000               # default: 1000
      timeout_ms: 60000               # default: 60000
    # or
      type: tcp
      host: localhost                 # default: localhost (port-free pre-check applies)
      port: 5432
      timeout_ms: 30000
    # or
      type: log-pattern
      pattern: 'Compiled successfully'
      timeout_ms: 60000
    # or
      type: exit-code                 # one-shot: process must exit 0; state ends as `finished`
      timeout_ms: 60000
    # or
      type: custom
      command: 'curl -fsS localhost:3000/ready'

    restart: on-failure | always | never  # default: never (no auto-retry).
                                          # Set to `on-failure` to retry crashes up to `max_retries`.
    restart_delay_ms: 2000
    max_retries: 3                        # only relevant when restart != never

    manual_retry: true     # default: false
    # When false: a boot-time failure aborts `orc start` with exit 1.
    # When true:  Orckit stays alive with the process in `failed` and any
    #             dependents `pending`; you fix the issue and type `r <name>`
    #             at the prompt to retry. Use for processes that depend on
    #             external infra you control (Docker daemon, VPN, etc).

    optional: true         # default: false
    # When false: included in the default `orc start` run.
    # When true:  skipped by default. Start it explicitly with
    #             `orc start <name>` (just this + deps), additively with
    #             `orc start --with <name>` (default set + this), at runtime
    #             with `start <name>` in the REPL, or by clicking ▶ in the
    #             web UI. A required process is not allowed to `depends_on`
    #             an optional one — that would force the optional one to
    #             always start.

    ports: [8080, 9099, 4000]       # default: []. Ports this process binds.
    kill_orphan_ports: true         # default: false. After the normal stop path
                                    # (SIGTERM → grace → SIGKILL of the whole
                                    # process group/tree), force-kill anything
                                    # still bound to one of `ports`. For tools
                                    # whose children escape the process group and
                                    # keep a port bound after the tree is gone —
                                    # classically the JVM-based Firebase emulators.
                                    # POSIX-only (needs `lsof`); kills *whatever*
                                    # owns the port, so only enable it for ports
                                    # you know are yours. A `tcp` ready-check port
                                    # is swept automatically, no need to repeat it.

    hooks:                          # orc announces each as `↪ <name> <hook> hook`
      pre_start: 'npm install'      #   when it fires; a failing hook shows in red
      post_start: 'echo ready'      #   (a failing pre_start aborts the spawn). The
      pre_stop: 'echo stopping'     #   hook command's own stdout is not streamed.
      post_stop: 'echo stopped'

    hook_timeout_ms: 60000   # max ms any single hook may run; default 60000.
                             # Bump for slow pre_start installs (e.g. a cold
                             # `pnpm install` of Angular/Next can exceed a minute).

    stop_grace_ms: 10000     # ms to wait after SIGTERM before escalating to
                             # SIGKILL; default 10000. Raise it for anything that
                             # must flush on shutdown (a database checkpointing,
                             # a cache being written) where SIGKILL costs work.

    output:
      suppress: ['^node_modules', 'webpack-dev-middleware']  # regex; matches are dropped
      include: ['^ERROR']                                    # regex; ONLY matches are kept (if set)
      highlight:
        - pattern: 'ERROR'
          color: red

    buffer_size: 1000   # in-memory output lines kept per process; default 1000
```

### Process types

- **bash** — default. Runs the command via `bash -c`.
- **webpack** — same as bash, plus a stdout parser that emits `build:start` / `build:progress` / `build:complete` / `build:failed` events on standard webpack output.
- **angular** — same as bash, plus an Angular CLI output parser.
- **docker** — same as bash, plus automatic container lifecycle management for `docker run`-style commands. A `docker run`'s container is owned by the daemon, not the local CLI, so killing the CLI leaves the container (and its published ports) running. To handle that, orckit `docker rm -f <container_name>`s the container at two points: **before every spawn** (so a container left behind by a previous crashed run doesn't block the new `docker run --name <container_name> ...` with a name conflict), and **after the process is stopped or killed** (so the container is gone and its ports are free for the next boot). On shutdown the `docker run` CLI itself gets a normal SIGTERM — Docker forwards it to the container for a graceful stop — and the `docker rm -f` then guarantees removal even if the container ignored the signal or the CLI was SIGKILLed. `container_name` is required and must match the `--name=` in `command`. Cleanup failures (no such container, daemon down, docker not installed) are silently ignored — the `docker run` itself surfaces the real error.

```yaml
processes:
  postgres:
    type: docker
    container_name: my-app-db
    command: docker run --rm --name=my-app-db -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16
    ready: { type: tcp, port: 5432 }
```

For shapes a single `container_name` can't cover (e.g. `docker compose up` / `docker compose down`), stay on `type: bash` with an explicit `stop_command`.

The parsers are best-effort regex against modern tool output and exist purely so the CLI reporter can show useful build status. If you don't care about that, just use `bash`.

### Port-conflict guard

For processes with a `type: tcp` or `type: http` ready check pointing at a localhost port, orckit verifies the port is actually free *before* spawning. If a stale process is still bound to it (a leftover Firestore emulator, a previous `orc start` that didn't shut down cleanly, a forgotten Docker container, etc.), the probe would otherwise immediately connect to that listener and falsely report the new process as `✓ ready (Xms)` — while the new command itself dies with a `port taken` error a moment later. Catching it pre-spawn turns the confusing two-step into a single clear failure:

```
✗ emulators failed: port 8080 is already in use — another process is bound to it
  (the ready check would falsely succeed against the existing listener).
  Stop the other process and retry — `lsof -i :8080` shows what's holding it.
```

The check is automatic and limited to TCP/HTTP probes on `localhost` / `127.0.0.1` / `0.0.0.0` / `::1`. If you intentionally want a probe to target something not owned by the process (rare), use `type: custom` or `type: log-pattern` instead.

This is the per-process backstop. The blocked-port check described in
[Shutdown and orphaned processes](#blocked-ports-at-boot) runs earlier — before
anything spawns, across every port the whole boot needs — and can free them for
you rather than just failing.

## Per-process log files

Set `logs.enabled: true` at the top level of `orckit.yaml` to write each process's stdout/stderr to its own file in `logs.dir` (default `.orckit/logs`, relative to the working directory). Files are append-only — every spawn (initial start, auto-restart, manual retry) writes a banner so a single file can carry many sessions:

```
========================================================================
== api started 2026-05-24T10:32:18.812Z (pid 12345)
========================================================================
  Listening on http://localhost:3000
! Warning: deprecated config key
-- 2026-05-24T10:35:02.110Z stopped

========================================================================
== api started 2026-05-24T10:35:04.260Z (pid 12410)
========================================================================
  Listening on http://localhost:3000
```

`stdout` lines are prefixed with two spaces; `stderr` with `! `. `output.suppress` / `include` filters apply (matched-out lines are not written). The CLI reporter still runs as normal — log files are additive. Add `.orckit/` to your `.gitignore` if you store the logs in the repo.

Programmatically: `attachLogReporter(orckit, { dir })` returns a handle with a `dispose()` you must call during teardown.

## MCP server

`orc start` runs a built-in [Model Context Protocol](https://modelcontextprotocol.io) server alongside the orchestrator so Claude Code (or any MCP client) can query process status, errors, and recent output without spawning its own `orc`. You keep running `orc start` in your terminal as usual; the MCP server is reachable in parallel on `127.0.0.1:7676`.

When `orc start` boots, it prints the URL and a one-liner to register it with Claude Code:

```
  mcp:  http://127.0.0.1:7676/mcp
        claude mcp add --transport http orckit http://127.0.0.1:7676/mcp
```

Run that `claude mcp add` command once. From then on, Claude Code can call:

| Tool | Returns |
|---|---|
| `get_status` | Every process with state, PID, uptime, retry count, and whether it's `manual_retry: true` |
| `get_errors` | Failed processes only, with last error message + last ~50 lines of stderr per process |
| `get_logs` | Recent stdout/stderr for a named process (`{name, lines?, stream?}`) |
| `get_build_status` | Build phase (building/done/failed), error/warning counts, duration, and failure diagnostics per build process (`{name?}` — omit for all) |
| `wait_for_build` | Blocks until the named process's build settles, then returns success/failure with diagnostics (`{name, timeout_ms?}`) |

`get_build_status` and `wait_for_build` let an agent **defer to orckit's running build instead of spawning its own**: orckit already runs the project's `webpack`/`angular` watch processes, so an agent verifying a change should `wait_for_build` for the result rather than starting a duplicate compile. (Build phase is only tracked for process `type`s with a parser — currently `webpack` and `angular`.)

When `orc start` isn't running, the MCP tools simply fail to connect — Claude reports that orckit isn't running, no further configuration needed.

Configure via the `mcp:` block in `orckit.yaml`, or override on the command line:

- `--mcp-port <port>` — bind to a different port (also requires `mcp.enabled: true` in YAML).
- `--no-mcp` — force-disable, overriding YAML.

The server binds to `127.0.0.1` by default. Change `mcp.host` only if you understand the access-control implications — the MCP tools are read-only, but they expose process output that may contain secrets.

## Programmatic API

```ts
import { Orckit, loadConfig } from '@orckit/cli';

const orckit = new Orckit(loadConfig('./orckit.yaml'));

orckit.on('process:ready', (name, ms) => console.log(`${name} ready in ${ms}ms`));
orckit.on('process:failed', (name, err) => console.error(`${name} failed`, err));

await orckit.start(['api']);   // starts api + its deps
console.log(orckit.states());  // Map<name, ProcessState>

await orckit.dispose();        // stop everything in reverse dependency order
```

### Events

| Event | Payload |
|---|---|
| `preflight:start` | — |
| `preflight:result` | `PreflightResult` |
| `preflight:complete` | `allPassed: boolean` |
| `process:state` | `name`, `ProcessState` |
| `process:starting` | `name` — about to spawn (the subprocess does not exist yet) |
| `process:spawned` | `name`, `pid`, `command` — the subprocess exists; `pid` is also its process-group id |
| `process:ready` | `name`, `durationMs` — long-running process passed its health check (not emitted for `ready: exit-code`) |
| `process:running` | `name` — long-running process is now in operational state |
| `process:finished` | `name`, `durationMs` — one-shot (`ready: exit-code`) completed successfully |
| `process:stopping` | `name` — graceful stop has begun (SIGTERM sent / `stop_command` run) |
| `process:killed` | `name`, `signal` — a termination signal was sent; `SIGTERM` on graceful stop, `SIGKILL` if the grace window expired and the process had to be force-killed |
| `process:port-freed` | `name`, `port`, `pid` — an orphan still holding one of the process's `ports` was force-killed by the post-stop sweep (`kill_orphan_ports`) |
| `process:escaped` | `name` — a descendant escaped the process group and survived the SIGKILL of the tree, so teardown could not prove it was reaped. Rare; usually fixed by declaring `ports` with `kill_orphan_ports: true` |
| `process:stopped` | `name`, `durationMs?` — process has exited; duration is how long the stop took |
| `process:failed` | `name`, `Error?` |
| `process:restarting` | `name`, `attempt` |
| `process:line` | `name`, `OutputLine` |
| `process:build` | `name`, `BuildEvent` |
| `hook:start` / `hook:complete` / `hook:failed` | `name`, `hook`, `Error?` |
| `hook:line` | `name`, `hook`, `text`, `stream` — a single stdout/stderr line streamed from a running lifecycle hook |
| `boot:complete` | `{ ready: string[], failed: string[], pending: string[] }` — always fires after `start()` |
| `all:ready` | `names: string[]` — only fires when nothing failed and nothing pending |

`ProcessState` values:

- Long-running: `pending` → `starting` → `ready` → `running` → `stopping` → `stopped`/`failed`
- One-shot (`ready: exit-code`): `pending` → `starting` → `ready` → `finished` (terminal — the process has exited 0 and downstream deps treat it as satisfied)

The state machine is exported as a pure function (`transition(state, event)`) so it's trivial to test or reuse.

### Interactive retry (`orc start` REPL)

By default a boot-time failure aborts `orc start` (exit 1). Mark a process `manual_retry: true` to opt into fix-and-retry instead: the orchestrator stays alive, dependents of the failed process(es) stay `pending`, and `orc start` opens a REPL prompt on stdin (if it's a TTY) so you can fix the underlying issue without restarting the whole stack:

```
1 ready  1 failed (api)  1 pending (web)
type `r api` to retry, ? for help
> r api
  ↻ api restarting (manual)
  ✓ api ready (812ms)
  ⠋ web starting          ← auto-unblocked once api was ready
  ✓ web ready (1.2s)
>
```

| input | meaning |
|---|---|
| `r [name ...]` | retry failed processes; cascade to dependents (default) |
| `r! [name ...]` | retry without cascading to dependents |
| `start <name>` | start a process (typical for optional ones); pulls in deps |
| `+ <name>` | shorthand for `start` |
| `s` | print current status table |
| `q` | quit (same as Ctrl-C) |
| `?` / `h` | help |

Cascade restart replays a process **and all of its transitive dependents** in dependency order — the common case when an upstream service has restarted and downstream connections need to be refreshed. Pass `--no-repl` to `orc start` to suppress the prompt entirely. Programmatically: `orckit.restart(['api'], { cascade: true })`.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test             # all tests
pnpm test:unit        # everything except integration
pnpm test:integration # spawns real bash processes
pnpm build
```

Architecture lives in [CLAUDE.md](CLAUDE.md). The TL;DR: each `src/` subdirectory has a single concern; every module is independently testable; no inheritance in the runner; the schema is the single source of truth for types.

## License

MIT
