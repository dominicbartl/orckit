# CLAUDE.md — Orckit Architecture Guide

This file orients agents and contributors. Read [README.md](README.md) for the user-facing pitch and config reference.

## What this is

A lean CLI process orchestrator. It takes a YAML config, builds a dependency graph of processes, starts them in topological order (parallel within waves), watches health checks for readiness, forwards output, applies restart policies, and tears everything down on signal.

It is **not** a tmux integration, a dashboard UI, a build-tool plugin host, a daemon, or a resource monitor. Past iterations had all of those; they were dropped in the 0.2 rewrite. If you find yourself adding one, build it as a separate package that consumes the orchestrator via its event API.

## Repository layout

```
src/
  cli.ts              # CLI entry — Commander commands, signal handling
  index.ts            # Library exports

  config/
    schema.ts         # Zod schemas — SINGLE source of truth for config types
    load.ts           # YAML → validated config
    duration.ts       # parseDuration / formatDuration helpers

  graph/
    resolver.ts       # buildGraph, resolveStartOrder (Kahn), groupIntoWaves,
                      # transitiveDependencies, filterToTargets, visualize

  health/
    checks.ts         # HttpProbe, TcpProbe, LogPatternProbe, CustomProbe
    wait.ts           # waitForReady polling loop with abort support

  process/
    runner.ts         # Single Runner class; subprocess + line-buffered I/O
    parsers.ts        # Pure (line) => BuildEvent | null parsers
    build-tracker.ts  # trackBuilds(orckit) — subscribes to process:build and
                      # reduces the event stream into per-process BuildStatus +
                      # diagnostics. Shared by the web AND mcp servers so they
                      # never drift on build-outcome accumulation.
    output.ts         # OutputBuffer with suppress/include/highlight filters

  orchestrator/
    lifecycle.ts      # Pure state machine: transition(state, event) → state
    hooks.ts          # runHook(kind, hooks, ctx)
    preflight.ts      # runPreflight([{name, command, on_fail}])
    orchestrator.ts   # Orckit class — coordinates everything, emits events

  reporter/
    dashboard.ts      # attachDashboard — persistent live region (brand header +
                      # dependency graph + counter footer). Owns lifecycle +
                      # build-state rendering for the whole session on a TTY.
    cli-reporter.ts   # Preflight banner, failure-tail dump, optional
                      # --show-output / --show-build streams. Rides above the
                      # dashboard via its printAbove sink.
    shutdown-reporter.ts # Verbose teardown log, attached by the CLI for the
                      # duration of a shutdown (replaces the live reporter):
                      # per-process stopping/stopped/timeout status + piped
                      # process & hook output, indented and name-tagged.
    graph-view.ts     # Pure renderGraph(graph, opts) — wave-grouped tree used
                      # by `orc validate` AND the dashboard.
    brand.ts          # ANSI brand mark (mirrors the SVG bars in web-ui),
                      # plus brandHeader(labels) for the dashboard top region.
    log-reporter.ts   # Per-process .log files, one writer per process.
    session-tracker.ts # Maintains util/session-state.ts's file from
                      # process:spawned / stopped / failed / finished.
    repl.ts           # Plain-mode interactive prompt (r / r! / s / q).
                      # Not attached when the dashboard is on — browser owns
                      # the action surface in that mode.
    debug.ts          # Minimal namespaced logger (ORCKIT_DEBUG=ns1,ns2)

  mcp/
    server.ts         # attachMcpServer — Streamable HTTP MCP listener that
                      # exposes the running Orckit instance to MCP clients
    tools.ts          # Pure handlers for the read-only tools (get_status /
                      # get_errors / get_logs / get_build_status /
                      # wait_for_build). wait_for_build long-polls process:build
                      # until the build settles (quiet-period debounce).

  web/
    server.ts         # attachWebUi — HTTP listener for the browser dashboard
                      # (serves bundled SPA + SSE event stream + action API)
    events.ts         # streamOrckitEvents — pushes Orckit events over SSE
    snapshot.ts       # buildSnapshot — serializable view of Orckit state
    static.ts         # serveStaticAsset + resolveStaticDir for the SPA shell
    ide.ts            # detectIde — finds a .idea folder at/above the config and
                      # returns an IdeLink { command, root } (in the snapshot).
                      # The web UI's file links POST to /api/open, which opens
                      # files under `root` in that IDE launcher and files outside
                      # it in the OS default app (no plugin/Toolbox)

  util/
    env.ts            # mergeEnv (process.env + extras)
    process-tree.ts   # snapshot-BEFORE-signal teardown primitives:
                      # collectProcessTree (+Sync), signalTree, survivors.
                      # Signals every pgid in the tree, not just the root's —
                      # `set -m` wrapper scripts lead their own groups.
    port.ts           # isPortFree, findPortHolders (LISTEN only),
                      # describePortHolders (pid/command/start time), freePort
                      # (SIGTERM → grace → SIGKILL), killPortHolders
    blocked-ports.ts  # collectExpectedPorts (every port a boot needs) +
                      # findBlockedPorts + isContainerProxy. Backs the CLI's
                      # pre-boot conflict check.
    session-state.ts  # .orckit/session.json — the spawned process groups of the
                      # CURRENT run, so the NEXT `orc start` can reap them if
                      # this one is SIGKILLed (the one exit no handler covers).
                      # Survivors are PID-reuse-guarded by command match.
    line-stream.ts    # bindLineStream — shared line-buffered stream reader
                      # (Runner output + streamed hook output)

packages/
  web-ui/             # @orckit/web-ui workspace — SolidJS + Vite + Tailwind v4
                      # frontend. NOT published. `pnpm build:web` builds it and
                      # copies dist/ into `dist/web/static/` for the npm tarball.

tests/
  config/  graph/  health/  process/  orchestrator/  util/    # unit tests
  integration/                                                # end-to-end
```

Every file has one responsibility. There are no 3-file modules masquerading as one concept.

## Key design rules

1. **Schema is the source of truth for types.** Every config type comes from `z.infer<typeof someSchema>` in `src/config/schema.ts`. Do not declare a parallel `interface` for config shapes anywhere else.
2. **No runner inheritance.** There is one `Runner` class. Tool-specific behavior is a pure function in `process/parsers.ts` selected by `getParser(type)`. Adding a new build tool = adding one parser function + one case in `getParser`.
3. **Lifecycle is a pure state machine.** `transition(state, event)` in `orchestrator/lifecycle.ts` has zero side effects. The orchestrator threads side effects (event emission, runner control) around it. Test the machine in isolation; trust it everywhere else.
4. **Orchestrator emits events; reporter renders.** Don't `console.log` from `orchestrator/*` or `process/*`. The CLI reporter (or any consumer) listens and decides what to display. Tests assert against events, not stdout.
5. **No singletons, no module-level mutable state.** The debug logger reads env once at import; everything else is per-instance.
6. **Stop with grace.** `Runner.stop(graceMs)` sends SIGTERM via tree-kill, waits, escalates to SIGKILL. The orchestrator stops processes in reverse dependency order.
7. **Tests adjacent to source.** `tests/<area>/<file>.test.ts` mirrors `src/<area>/<file>.ts`. Unit tests for pure code; integration tests (in `tests/integration/`) spawn real bash processes through the full `Orckit` API.

## Process lifecycle in detail

```
                ┌──> ready ──> running ────────┐
pending ──> starting                            ├──> stopping ──> stopped
                └──> failed <──── exit/timeout ─┘                  ↑
                       │                                           │
                       └──> (restart policy)                       │
                       │                                           │
                       └──> starting ...                           │
                                                                   │
running ──(SIGTERM/SIGKILL via dispose)──────────────────────────> stopping
```

- `exit-code` ready checks: spawn → await exit → if 0, ready+running (process is gone but state stays "running" to satisfy downstream deps).
- Long-running with health probe: spawn → race(`waitForReady(probe)`, `runner.exit`) → ready+running; if exit wins, fail.
- Unexpected exit while `running`: fail → maybe restart per policy with `restart_delay_ms` and `max_retries`. The auto-restart delay is wrapped in an `AbortController` stored on the handle so a manual `restart()` can preempt it.
- Explicit `stop()`: pre_stop hook → SIGTERM → grace → SIGKILL → post_stop hook → emit stopped.

### Shutdown: the no-orphan invariant

Children are spawned `detached`, so they never receive the terminal's Ctrl-C —
**orckit's teardown is the only thing that can stop them**, and every exit path
must run it. The rules that keep this true:

- **Snapshot before you signal** (`util/process-tree.ts`). `Runner.stop()`
  collects the full descendant tree *first*, then signals. Killing first and
  walking `ppid` afterwards (what `tree-kill` did) loses every escaped subtree:
  the parent dies, its children reparent to init, and the walk returns nothing.
  The snapshot is also retained on the runner (`lastTree`) because the emergency
  path runs *after* a graceful stop has already killed the intermediate parents.
- **Signal every pgid in the tree, not just the root's.** A wrapper script with
  `set -m` (bash monitor mode) puts each job in its own process group, so
  `kill(-rootPgid)` misses it entirely. This is why `firebase emulators`,
  `docker run &` and `stripe listen` behind `pnpm <script>` used to survive.
- **Verify, don't assume.** After the direct child exits, `reapSurvivors()`
  checks the snapshot and escalates on anything still alive; only if something
  outlives even that does it emit `process:escaped`.

- `spawnAndAwaitReady` is cancellable at *every* await point. Each attempt owns
  an `AbortController` (`handle.shutdown`) created **before** the first await, so
  a stop landing mid-`pre_start`-hook cancels the hook (via execa's
  `cancelSignal`) and the spawn behind it never happens. It re-checks
  `cancelled()` after each await and immediately before `runner.start()`, and
  unwinds with `StartupAbortedError` — which is *not* a failure and must not
  mark the process `failed`.
- `handle.startup` holds the in-flight startup promise; `stopOne` aborts and
  **awaits** it, including for non-active states (a `pending` process whose hook
  is still running). Teardown cannot finish while a startup is unwinding.
- `stopping` (full stop) and `disposed` (one-way, set by `dispose()`) gate every
  spawn path: the wave loop, `startTargets`, `restart`, `kickPending`,
  `maybeRestart` (re-checked *after* its delay), and the web action endpoints.
  A targeted `stop([name])` deliberately does NOT set `stopping`.
- Stop hooks (`pre_stop`/`post_stop`) can never block the kill path — their
  rejections are caught in `stopOne`. A failing hook used to abort the whole
  teardown and orphan everything still inside its grace window.
- `emergencyKill()` is the synchronous last resort (double Ctrl-C,
  `uncaughtException`, `unhandledRejection`, shutdown watchdog): SIGKILLs every
  live process group and `docker rm -f`s containers with no awaits.
- The CLI handles SIGINT/SIGTERM/**SIGHUP**, is single-flight (a boot failure
  arriving during a signal-driven shutdown joins it instead of hard-exiting),
  and never calls `process.exit()` on a path that leaves children alive.

When changing any of this, re-run `tests/integration/shutdown.test.ts` — it
spawns real processes and asserts nothing survives.

### Partial boot + manual retry

`Orckit.start()` uses `Promise.allSettled` per wave. It returns a `BootSummary` and emits `boot:complete: { ready, failed, pending }`. Processes whose deps failed stay `pending`. `all:ready` only fires when everything succeeded.

**Strict-by-default**: if any failed process did not opt in via `manual_retry: true`, `start()` emits `boot:complete` and then throws `BootFailedError` with the list of strict failures. The CLI catches it, prints a hint about `manual_retry`, and exits 1. Auto-restart policy still applies (a `restart: on-failure` process gets its retries before being declared failed); `manual_retry` only governs what happens once the retry budget is exhausted at boot time.

Mark a process `manual_retry: true` to let its boot failure be recoverable: `start()` does not throw, the REPL opens, the user types `r <name>` to retry.

`Orckit.restart(targets, { cascade = true })` stops then re-starts the listed processes and (by default) all their transitive dependents in dependency order. After the restart loop, `kickPending()` walks pending processes and starts any whose deps have become ready — that's how a successful manual retry unblocks the downstream chain that was waiting on it.

`kickPending` is suppressed while `inStartLoop` is true (during initial boot AND during `restart()`'s start loop), so the wave/loop driver doesn't race a fire-and-forget kick on the same process.

The interactive REPL in `src/cli.ts` (`reporter/repl.ts`) is the plain-mode action surface: typing `r backend` calls `restart(['backend'], { cascade: true })`. It only attaches when the persistent dashboard is *not* active (`--no-live` or non-TTY) — when the dashboard is on, the browser owns restart/stop instead. `--no-repl` further opts out of attaching it in plain mode.

### Optional processes

A process with `optional: true` is *not* part of the default boot set. To run one:
- explicit target: `orc start <name>` boots only it + its deps
- additive: `orc start --with <name>` boots the default set + this one
- at runtime: `start <name>` in the REPL or `POST /api/start/:name` from the web UI — both call `orckit.startTargets([name])`, which resolves transitive deps, skips already-running shared deps, and does **not** emit `boot:complete` or throw `BootFailedError` (the caller asked for it, so failures are theirs to handle).

Cross-process schema validation in `orckitConfigSchema` rejects a required process declaring `depends_on` on an optional one: an optional that's force-started by another process can't really be optional, so it's a config bug.

Snapshot exposes `optional: boolean` so the web UI can render a ▶ start button for pending optionals.

## MCP server: how Claude Code queries a running orckit

`src/mcp/` is a reporter-style consumer of Orckit: `attachMcpServer(orckit, opts)` follows the same shape as `attachLogReporter` — it subscribes to events (last-error tracking + a shared `trackBuilds` for build state), exposes mostly synchronous queries from the Orckit instance, and returns a handle with `dispose()`. It runs **inside the `orc start` process** over Streamable HTTP on `127.0.0.1:7676` (configurable via the `mcp:` YAML block or `--mcp-port` / `--no-mcp`). There is no separate `orc mcp` subcommand and no IPC layer.

Three layers:
1. **`mcp/tools.ts`** — pure handlers that take an `OrckitView` (a structural subset of `Orckit`) and produce text + JSON. Trivial to unit-test against a stub. The one non-synchronous tool is `wait_for_build`, which long-polls the `process:build` stream (via a `BuildEventSource`) until the build settles, with a quiet-period debounce so a stream of `build:failed` diagnostics collects fully before resolving.
2. **`mcp/server.ts`** — the HTTP server. In stateless Streamable HTTP mode the SDK requires a fresh `StreamableHTTPServerTransport` + `McpServer` per request (see the SDK's `simpleStatelessStreamableHttp` example); `attachMcpServer` does this in its request handler.
3. **`cli.ts start`** — resolves effective settings (CLI flag > YAML > schema default), calls `attachMcpServer`, prints the URL and a `claude mcp add` hint.

Anything that needs a richer view than `inspect(name)` / `states()` / `output(name, n)` should grow Orckit's public surface additively, not reach into private state.

## Web dashboard: how a browser drives a running orckit

`src/web/` is another reporter-style consumer of Orckit. `attachWebUi(orckit, opts)` returns a `{ url, port, dispose() }` handle just like `attachMcpServer`, runs in-process over HTTP on `127.0.0.1:7677` (configurable via `web:` YAML block or `--web-port` / `--no-web`), and serves three things from the same listener:

- **the SPA shell** (`packages/web-ui/dist/*`) — built artifacts copied into `dist/web/static/` at package-build time
- **`GET /api/state` + `GET /api/output/:name`** — initial-hydration snapshots over JSON
- **`GET /events`** — SSE stream of orckit events, beginning with a full snapshot for reconnect tolerance
- **`POST /api/restart/:name` + `POST /api/stop/:name`** — action endpoints calling `orckit.restart()` / `orckit.stop()` directly
- **`POST /api/open?file=&line=&column=`** — opens a file: under the project root via the configured IDE launcher (`ide.command`), outside it via the OS default app; 404s a non-existent file. Only meaningful when an `ide` was detected

The snapshot also carries an `ide: IdeLink | null` field (just `{ command }`, the IDE's CLI launcher). The CLI resolves it once at start (`detectIde` over the config's directory, gated on the `ide:` config block) and passes it to `attachWebUi`; the server echoes it into every snapshot. The frontend's `lib/ide.ts` parses file references in output (`src/app.ts:42:10`, `foo.ts(12,3)`, stack-trace frames) into segments, resolving each to an **absolute** path against the emitting process's working directory (each `ProcessSnapshot.cwd`, the absolute dir the Runner spawned it in) — a process with `cwd: /repo/packages/api` that logs `src/x.ts` resolves to `/repo/packages/api/src/x.ts`. The `LinkedText` component (used in the log view and the Errors panel) renders those as clickable spans; a click POSTs `/api/open?file=&line=&column=` to orckit. The server stats the file (404 if gone), then routes by `isUnderRoot(file, ide.root)`: under the project root → `ide.command --line N --column C <abs-file>` (args array, no shell); outside it → the OS default opener (`open` / `xdg-open` / `cmd /c start`), so temp files and generated artifacts don't hijack the IDE. The browser can't shell out itself, so this server round-trip is the mechanism; being same-origin, the POST returns a real status, so `LinkedText` toasts accurately on failure. This deliberately avoids the Toolbox `jetbrains://` scheme (needs Toolbox installed — a standalone IDE yields macOS error -600) and the built-in HTTP server's `/api/file` (needs the "IDE Remote Control" plugin since 2024.2). No `.idea` → `ide` is null → `LinkedText` renders plain text. Path parsing is a pure function with no test harness on the frontend side; the `/sink` page's "IDE deep links" fixture is the visual regression surface — keep it in sync.

The frontend lives in **`packages/web-ui/`** (a pnpm workspace, `@orckit/web-ui`, private, not published). It's SolidJS + Vite + Tailwind v4. Build it with `pnpm build:web` from the root; the static assets get copied into the cli package's tarball so end users get one `npm i @orckit/cli` without needing to run two build systems.

The `/sink` route is the design system kitchen sink — every component in every state with static fixtures. Keep it in sync when adding or modifying components in `packages/web-ui/src/components/`.

## Adding a new feature

- **New ready-check type**: add the Zod variant in `config/schema.ts`, add a class to `health/checks.ts`, add a case in `createProbe`. No other file should change.
- **New build-tool parser**: add a pure function to `process/parsers.ts` and a case in `getParser`. Add a Zod literal in `processTypeSchema`. Add tests in `tests/process/parsers.test.ts`.
- **New CLI command**: add to `src/cli.ts`. Use `loadConfig()` and build an `Orckit` instance; do not duplicate orchestration logic.
- **New event consumer (web UI, log file, OTEL)**: write it as a separate file that subscribes to `Orckit` events. Do not modify the orchestrator.

## Keeping public-facing docs in sync (REQUIRED)

[README.md](README.md), [AGENTS.md](AGENTS.md), and [examples/](examples) ship in the npm tarball and are the only thing consumers (humans + LLMs) see. They must reflect the current public API. **Any change that touches the public surface must update them in the same commit** — out-of-date docs are worse than missing docs because they get cached as ground truth.

What counts as "public surface":

| If you change… | …update |
|---|---|
| Any Zod field in `src/config/schema.ts` (add/rename/remove/default change) | README.md config reference, AGENTS.md decision trees + checklist, any affected example in `examples/` |
| Any export in `src/index.ts` (new/removed/renamed) | README.md programmatic API section, AGENTS.md programmatic API section |
| Any event emitted by `Orckit` (`src/orchestrator/orchestrator.ts`) | README.md events table |
| Any CLI command or flag (`src/cli.ts`) | README.md quick start, AGENTS.md workflow section |
| REPL commands (`src/reporter/repl.ts`) | README.md REPL section |
| MCP tool definitions or descriptions (`src/mcp/tools.ts`) | README.md MCP server section, AGENTS.md "Querying a running orckit" |
| Default values, error behavior, or anything that changes how a *working* config behaves | README.md, AGENTS.md anti-patterns / validation checklist if relevant |

Quick rules:
- AGENTS.md is for LLM agents writing configs / using the API — it's decision trees and pitfalls, not a field-by-field reference. Update it when the *advice* changes, not just when a field is added.
- README.md is the field-by-field reference. Update it any time the schema changes.
- Examples are ground truth for "what a working config looks like." If you add a feature worth showing, add or update an example. If you remove a feature, scrub it from existing examples.
- The `files` array in `package.json` controls what ships. If you add a new top-level doc file (e.g. `MIGRATION.md`), add it there or it won't reach consumers.

## What to avoid

- Putting display logic (chalk, formatting, console.log) anywhere outside `reporter/` and `cli.ts`.
- Adding "manager" or "service" classes that wrap a single function or hold a single instance — just export the function.
- Reintroducing inheritance into `Runner`. If a build tool needs special spawn behavior, model that as config, not a subclass.
- Resurrecting tmux integration, status dashboards, or build-tool library plugins inside this package. If you need them, build them as separate packages on top of the public event API.

## Common commands

```bash
pnpm dev                          # tsx watch on src/cli.ts
pnpm typecheck
pnpm test                         # all tests (~3s on a quiet machine)
pnpm test:unit                    # everything except tests/integration
pnpm test:integration             # spawns real bash processes
pnpm build                        # tsc → dist/, then build:web copies SPA assets
pnpm build:web                    # build just the @orckit/web-ui frontend
pnpm dev:web                      # vite dev server for the frontend
                                  # (proxies /api + /events to 127.0.0.1:7677)
ORCKIT_LOG_LEVEL=debug pnpm dev   # verbose internal logs
ORCKIT_DEBUG=Orckit,Runner pnpm dev   # per-namespace debug
```
