# AGENTS.md — using Orckit (for LLM agents)

This file is for AI agents (Claude, Cursor, Codex, etc.) helping a user write `orckit.yaml` configs or integrate `@orckit/cli` programmatically. For the human-facing reference see [README.md](README.md). For runnable configs see [examples/](examples) — each subdirectory is a self-contained example you can `orc start` against.

## What Orckit is

A CLI that takes a YAML file describing local-dev processes (db, api, web, workers...), starts them in dependency order, watches health checks for readiness, applies restart policies, and tears them down on Ctrl-C.

Use it when a developer needs `db → api → web` started in order with health checks between them. Do **not** use it for: production deployments, container orchestration, build pipelines, daemonized services, or as a "process manager" for already-running processes. Every process Orckit knows about is spawned and owned by Orckit.

## Workflow when generating a config

1. Identify the processes the developer needs running (look at `package.json` scripts, `docker-compose.yml`, READMEs, existing shell scripts).
2. Identify real runtime dependencies between them (api needs db, web needs api).
3. Pick a ready check per process — see the decision tree below.
4. Write `orckit.yaml`.
5. Run `npx orc validate -c orckit.yaml`. It parses the file, builds the dependency graph, prints both, and exits non-zero on any problem. **Always run this before declaring the config done.**
6. Optionally `npx orc start --show-output` to verify the boot sequence actually works.

## Minimal valid config

```yaml
processes:
  api:
    command: npm run dev
    ready:
      type: http
      url: http://localhost:3000/health
```

`processes` is required and must have at least one entry. Everything else has defaults. There is no required top-level `project` field (it defaults to `orckit`).

## Decision tree: which `ready` check?

A process is "ready" the moment it spawns *unless* it has a `ready` block. Pick the cheapest check that actually proves the process can serve traffic.

| Situation | Use |
|---|---|
| Process exposes HTTP with a `/health` (or any) endpoint | `type: http` |
| Process listens on a TCP port but has no HTTP (postgres, redis, raw sockets) | `type: tcp` |
| Process is a dev/build server that prints a known string on success (`compiled successfully`, `Local: http://...`) | `type: log-pattern` |
| One-shot command that must exit 0 (migrations, seed scripts, codegen) | `type: exit-code` |
| Custom shell probe (CLI tool, complex condition) | `type: custom` (`command:` runs on the interval and must exit 0) |
| Truly fire-and-forget (cosmetic tailer, screen banner) | omit `ready` |

**Common mistakes to avoid:**
- Using `type: tcp` for a Node/Python web server that has an HTTP endpoint. TCP only proves "port is bound"; HTTP proves "the app responds." Prefer HTTP when available.
- Using `type: log-pattern` against a server that *also* has a health endpoint. Log patterns are brittle — pick HTTP unless you have no choice.
- Setting any ready type *other than* `exit-code` on a one-shot command (migrations, codegen). The process exits and the orchestrator treats the early exit as failure. One-shots must use `type: exit-code` or be modelled as a `pre_start` hook on the process that needs them.
- Omitting `ready` on a process other consumers depend on. Without a ready check, "ready" fires immediately on spawn and dependents start before the upstream is actually serving.

## `depends_on`

Lists other process names that must reach `ready` before this one starts. Use it for real runtime dependencies only — not cosmetic ordering.

```yaml
processes:
  db:    { command: ..., ready: { type: tcp, port: 5432 } }
  api:   { command: ..., ready: { type: http, url: ... }, depends_on: [db] }
  web:   { command: ..., depends_on: [api] }
  worker:{ command: ..., depends_on: [db, api] }
```

Waves are computed automatically — `api` and `worker` would run in parallel if they didn't both depend on `db`. Cycles are rejected at validate time.

## `type`

- `type: bash` — default. Use unless one of the next two applies.
- `type: webpack` — only when *this process's* stdout is real webpack output. Adds a parser that emits `build:start`/`build:complete` events the reporter uses for progress display. Wrong `type` is not fatal — you just lose the progress UI.
- `type: angular` — same idea for Angular CLI output.

Do not pick `webpack`/`angular` just because the project uses webpack/angular somewhere. Pick it based on what the *command in this process* prints.

## `restart`

| Policy | When |
|---|---|
| `never` (default) | The default. A crashed process stays crashed. Use this for almost everything in local dev — when something dies, the user wants to see the error, not a retry loop that obscures it. |
| `on-failure` | Opt in when the process is genuinely transient-flaky (e.g. waits for a slow network mount) and a re-spawn is the right reflex. Restarts on crash, leaves alone on clean exit. |
| `always` | Background daemons you want kept alive regardless. Rare in dev. |

`max_retries: 3` is the default (only meaningful when `restart` is not `never`); `restart_delay_ms: 2000`. After `max_retries`, the process goes `failed`. What happens next is governed by `manual_retry` — see below.

Do **not** set `restart: always` on a command that exits 0 quickly — you get a tight respawn loop. Do **not** set `restart: on-failure` on a process whose failure mode is "config is wrong" (port taken, missing env var, syntax error) — retries will all fail the same way and just create noise. Prefer the default `never` and let the user fix it and rerun.

## `manual_retry`

Per-process boolean, default `false`. Controls what happens when a process fails at boot time after exhausting its auto-restart budget.

| `manual_retry` | Behavior on boot failure |
|---|---|
| `false` (default) | `orc start` aborts with exit 1. Use for normal services where a failure should fail the whole boot loudly. |
| `true` | Orckit stays alive with the process in `failed` and its dependents `pending`. The user fixes the issue and types `r <name>` at the REPL prompt to retry; cascade restart unblocks the dependents. |

Set `manual_retry: true` only for processes that legitimately need user intervention to recover — typically those depending on external infrastructure the user controls locally:

- a Docker container when the Docker daemon may not be running
- a service that needs a VPN connection, port-forward, or SSH tunnel
- a process requiring a USB device or hardware that may not be plugged in
- anything where "fix the thing and continue" is a normal workflow

Do **not** set it on a process whose failure means "my code is broken" — that's exactly when you want the boot to fail fast and surface the error. Restart-on-failure already covers transient flakiness.

Output is still captured the same way regardless of `manual_retry` — don't suppress useful error output that would help the user debug what they need to fix.

## `preflight`

Top-level checks that must pass *before* any process starts (docker running, env file present, port free). Run in parallel; any failure aborts boot.

```yaml
preflight:
  - name: docker-up
    command: docker info >/dev/null 2>&1
    on_fail: start Docker Desktop
```

Always include an `on_fail` with a one-line action the developer can take. Don't put process-specific setup in preflight — use `hooks.pre_start` on that process instead.

## `hooks` (per-process)

All four are shell strings, run synchronously, block the lifecycle phase they're in. Keep them fast.

- `pre_start` — before spawn. Use for `pnpm install`, `prisma generate`, etc. Failure aborts the process.
- `post_start` — after `ready`. Use for "open the URL" banners or notifications.
- `pre_stop` / `post_stop` — symmetric around shutdown.

For "install on first run," prefer commands that no-op when up-to-date (`pnpm install --silent`).

## `output` filters

```yaml
output:
  suppress: ['^DEBUG', 'webpack-dev-middleware']   # regex; drop matches
  include:  ['^ERROR']                             # regex; if set, ONLY matching lines survive
  highlight:
    - { pattern: 'ERROR|WARN', color: red }
    - { pattern: 'ready in',   color: green }
```

Applied in order: `suppress` drops matches first, then `include` (if non-empty) keeps only matches of what remains, then `highlight` colors what survives. Most configs only need `suppress` + `highlight`. Valid colors: `red green yellow blue magenta cyan gray`.

## `logs` (top-level, optional)

Off by default. Enable it when the terminal output isn't enough — e.g. flaky processes whose failures need post-mortem analysis, or stacks where multiple noisy services would interleave on stdout but each needs to be readable on its own.

```yaml
logs:
  enabled: true
  dir: .orckit/logs   # default; relative to cwd
```

Each process gets its own file. Sessions within a file are separated by a banner on every spawn (initial start, auto-restart, manual retry), so restart history is preserved. `output.suppress` / `include` still apply — log files contain exactly what the CLI reporter would show with `--show-output`. Suggest the user add `.orckit/` to `.gitignore` when enabling.

Do **not** enable it just because you can — for short-lived dev sessions, the in-memory `buffer_size` is usually enough and avoids leftover files. Enable when sessions are long, processes are flaky, or the user has asked for persistent logs.

## Environment and secrets

`env` is a `{ KEY: value }` map merged into the spawned process's environment. **Do not put secrets in `env`** — the YAML is checked in. Tell the user to:

- source from a local `.env` (using their own shell or a wrapper command), or
- reference shell variables in `command` (`command: API_KEY=$API_KEY node server.js`) and rely on the parent shell to provide them.

## Anti-patterns — push back on these

- "Can you model our production k8s setup in Orckit?" → wrong tool. Orckit is local dev only.
- "Can Orckit attach to a server I started in another terminal?" → no, every process is spawned by Orckit.
- "Make these two processes' logs print in order." → within a wave processes start in parallel; logs interleave.
- "Add a process that just `sleep`s to delay startup." → use `depends_on` and `ready` instead.
- Hardcoded secrets in `env`.

## Validation checklist (run before handing back)

1. `npx orc validate -c <path>` exits 0.
2. Every process either has a `ready` check appropriate to its nature, or is intentionally fire-and-forget.
3. `depends_on` reflects real runtime dependencies, not preferences.
4. Every preflight check has an actionable `on_fail` message.
5. `restart` policy matches the process's nature (long-running vs one-shot).
6. `manual_retry: true` only on processes whose failure means "external thing isn't ready" — not on regular services.
7. No secrets in `env`.

## Programmatic API

```ts
import { Orckit, loadConfig } from '@orckit/cli';

const orckit = new Orckit(loadConfig('./orckit.yaml'));

orckit.on('process:ready', (name, ms) => console.log(`${name} ready in ${ms}ms`));
orckit.on('process:failed', (name, err) => console.error(`${name} failed`, err));

await orckit.start(['api']);       // starts api + its transitive deps
// ... do work ...
await orckit.dispose();            // graceful tear-down in reverse dep order
```

All config types come from Zod schemas and are re-exported from the package root (`OrckitConfig`, `ProcessConfig`, `ReadyCheck`, etc.). The lifecycle state machine is exported as a pure function:

```ts
import { transition } from '@orckit/cli';
const next = transition('starting', { kind: 'ready' });  // -> 'ready'
```

Full event list and CLI flag reference: [README.md](README.md).

## Where to look

- **Schema (authoritative for every field, every default):** [src/config/schema.ts](src/config/schema.ts)
- **Runnable examples:** [examples/](examples) — minimal → fullstack, each with its own YAML and README. Best way to ground a generated config in something known-good.
- **Human reference + CLI flags + REPL commands:** [README.md](README.md)
