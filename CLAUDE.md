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
    output.ts         # OutputBuffer with suppress/include/highlight filters

  orchestrator/
    lifecycle.ts      # Pure state machine: transition(state, event) → state
    hooks.ts          # runHook(kind, hooks, ctx)
    preflight.ts      # runPreflight([{name, command, on_fail}])
    orchestrator.ts   # Orckit class — coordinates everything, emits events

  reporter/
    cli-reporter.ts   # Subscribes to Orckit events, writes to console
    debug.ts          # Minimal namespaced logger (ORCKIT_DEBUG=ns1,ns2)

  util/
    env.ts            # mergeEnv (process.env + extras)
    port.ts           # isPortFree

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
- Unexpected exit while `running`: fail → maybe restart per policy with `restart_delay_ms` and `max_retries`.
- Explicit `stop()`: pre_stop hook → SIGTERM → grace → SIGKILL → post_stop hook → emit stopped.

## Adding a new feature

- **New ready-check type**: add the Zod variant in `config/schema.ts`, add a class to `health/checks.ts`, add a case in `createProbe`. No other file should change.
- **New build-tool parser**: add a pure function to `process/parsers.ts` and a case in `getParser`. Add a Zod literal in `processTypeSchema`. Add tests in `tests/process/parsers.test.ts`.
- **New CLI command**: add to `src/cli.ts`. Use `loadConfig()` and build an `Orckit` instance; do not duplicate orchestration logic.
- **New event consumer (web UI, log file, OTEL)**: write it as a separate file that subscribes to `Orckit` events. Do not modify the orchestrator.

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
pnpm build                        # tsc → dist/
ORCKIT_LOG_LEVEL=debug pnpm dev   # verbose internal logs
ORCKIT_DEBUG=Orckit,Runner pnpm dev   # per-namespace debug
```
