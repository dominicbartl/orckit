# Orckit

A lean CLI for orchestrating multiple processes in local development. Think a single-binary, opinionated replacement for a handful of shell scripts plus `tmux` plus `wait-on`.

It takes a YAML file describing your processes, their dependencies, and how to know they're ready — then starts them in the right order, watches for failures, restarts on policy, and tears everything down cleanly on Ctrl-C.

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
    command: docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:15
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
npx orc start --show-output  # also stream stdout/stderr to the terminal
```

Ctrl-C triggers graceful shutdown (SIGTERM → 10s grace → SIGKILL).

## Configuration reference

```yaml
project: my-project          # optional, used in CLI output

logs:                        # optional; off by default
  enabled: true              # default: false
  dir: .orckit/logs          # default: .orckit/logs (relative to cwd)

preflight:                   # optional pre-startup checks (run in parallel)
  - name: docker-up
    command: docker info >/dev/null
    on_fail: start Docker Desktop

processes:
  <name>:
    type: bash | webpack | angular   # default: bash
    command: <shell command>          # required
    cwd: <path>                       # default: current dir
    category: <string>                # cosmetic grouping; default: 'default'
    env: { KEY: value }
    depends_on: [other-process-name, ...]

    ready:                            # optional; without it the process is "ready" as soon as it spawns
      type: http
      url: http://localhost:3000/health
      expected_status: 200            # default: 200
      interval_ms: 1000               # default: 1000
      timeout_ms: 60000               # default: 60000
    # or
      type: tcp
      host: localhost                 # default: localhost
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

    restart: on-failure | always | never  # default: on-failure
    restart_delay_ms: 2000
    max_retries: 3

    manual_retry: true     # default: false
    # When false: a boot-time failure aborts `orc start` with exit 1.
    # When true:  Orckit stays alive with the process in `failed` and any
    #             dependents `pending`; you fix the issue and type `r <name>`
    #             at the prompt to retry. Use for processes that depend on
    #             external infra you control (Docker daemon, VPN, etc).

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

The parsers are best-effort regex against modern tool output and exist purely so the CLI reporter can show useful build status. If you don't care about that, just use `bash`.

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
