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
    type: docker                           # auto-wires stop + orphan cleanup
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
```

Ctrl-C triggers graceful shutdown (SIGTERM → 10s grace → SIGKILL).

## Live dashboard

When stdout is a TTY, `orc start` pins a persistent dashboard to the bottom of the terminal for the whole session. It has three regions:

- **Header** — the orckit brand mark, project name, and labelled links to the web dashboard, MCP server, and log directory (whichever are enabled).
- **Dependency graph** — wave-grouped tree with a state icon per process (`○` pending, `⠋` animated while starting, `✓` ready, `✗` failed) and elapsed time once it settles. Webpack/Angular builds annotate their row with `building 67%`, `built 1.2s`, or `build failed`.
- **Footer** — `N/total ready · N building · N starting · N failed` counters that update live.

Preflight banners, failure tails (the recent stdout/stderr dump after a process dies), and `--show-output` lines print *above* the dashboard so they stay in scrollback while the live region keeps tracking state below them.

The browser dashboard at `http://127.0.0.1:7677` is the action surface — restart and stop buttons live there. The terminal REPL only attaches in plain mode (`--no-live` or a non-TTY stdout).

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

preflight:                   # optional pre-startup checks (run in parallel)
  - name: docker-up
    command: docker info >/dev/null
    on_fail: start Docker Desktop

processes:
  <name>:
    type: bash | webpack | angular | docker   # default: bash
    command: <shell command>          # required
    container_name: <name>            # required when type: docker; rejected otherwise.
                                      # Used to auto-fill stop_command and to nuke
                                      # orphan containers before spawn.
    stop_command: <shell command>     # optional; run *instead of* SIGTERM during shutdown.
                                      # Use for CLI clients managing external state — e.g.
                                      # `docker stop <name>` for a `docker run --name <name> ...`
                                      # process. Falls back to SIGKILL if the main process is
                                      # still alive after the grace period.
                                      # For `type: docker` defaults to `docker rm -f <container_name>`.
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

    hooks:
      pre_start: 'npm install'
      post_start: 'echo ready'
      pre_stop: 'echo stopping'
      post_stop: 'echo stopped'

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
- **docker** — same as bash, plus two conveniences for `docker run`-style commands. Before every spawn, orckit runs `docker rm -f <container_name>` so a container left behind by a previous crashed run doesn't block the new `docker run --name <container_name> ...` with a name conflict. And `stop_command` defaults to `docker rm -f <container_name>`, so Ctrl-C tears the container down even though the local `docker` CLI was just a client. `container_name` is required and must match the `--name=` in `command`. Orphan-cleanup failures (no such container, daemon down, docker not installed) are silently ignored — the `docker run` itself surfaces the real error.

```yaml
processes:
  postgres:
    type: docker
    container_name: my-app-db
    command: docker run --rm --name=my-app-db -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16
    ready: { type: tcp, port: 5432 }
```

For shapes orckit's docker defaults don't cover (e.g. `docker compose up` / `docker compose down`), stay on `type: bash` with an explicit `stop_command`.

The parsers are best-effort regex against modern tool output and exist purely so the CLI reporter can show useful build status. If you don't care about that, just use `bash`.

### Port-conflict guard

For processes with a `type: tcp` or `type: http` ready check pointing at a localhost port, orckit verifies the port is actually free *before* spawning. If a stale process is still bound to it (a leftover Firestore emulator, a previous `orc start` that didn't shut down cleanly, a forgotten Docker container, etc.), the probe would otherwise immediately connect to that listener and falsely report the new process as `✓ ready (Xms)` — while the new command itself dies with a `port taken` error a moment later. Catching it pre-spawn turns the confusing two-step into a single clear failure:

```
✗ emulators failed: port 8080 is already in use — another process is bound to it
  (the ready check would falsely succeed against the existing listener).
  Stop the other process and retry — `lsof -i :8080` shows what's holding it.
```

The check is automatic and limited to TCP/HTTP probes on `localhost` / `127.0.0.1` / `0.0.0.0` / `::1`. If you intentionally want a probe to target something not owned by the process (rare), use `type: custom` or `type: log-pattern` instead.

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
| `process:starting` | `name` |
| `process:ready` | `name`, `durationMs` — long-running process passed its health check (not emitted for `ready: exit-code`) |
| `process:running` | `name` — long-running process is now in operational state |
| `process:finished` | `name`, `durationMs` — one-shot (`ready: exit-code`) completed successfully |
| `process:stopped` | `name` |
| `process:failed` | `name`, `Error?` |
| `process:restarting` | `name`, `attempt` |
| `process:line` | `name`, `OutputLine` |
| `process:build` | `name`, `BuildEvent` |
| `hook:start` / `hook:complete` / `hook:failed` | `name`, `hook`, `Error?` |
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
