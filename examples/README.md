# Examples

Each directory is a self-contained Orckit example. Some are pure shell
(no install needed); others ship a `package.json` and let a `pre_start: pnpm
install` hook bootstrap their dependencies on first run.

| Example | What it shows |
|---|---|
| [`01-minimal`](01-minimal) | Two one-shot processes, `depends_on`, `ready: exit-code` |
| [`02-http-server`](02-http-server) | `ready: http`, `env`, `output.highlight`, `restart: on-failure`, `pre_start: pnpm install` |
| [`03-database-and-api`](03-database-and-api) | `ready: tcp`, `ready: http`, `depends_on` wave, `category` |
| [`04-log-pattern`](04-log-pattern) | `ready: log-pattern`, `output.suppress` / `include` / `highlight` |
| [`05-preflight-and-hooks`](05-preflight-and-hooks) | `preflight`, all four hooks (`pre_start` / `post_start` / `pre_stop` / `post_stop`) |
| [`06-restart-policy`](06-restart-policy) | `restart`, `restart_delay_ms`, `max_retries` |
| [`07-custom-ready`](07-custom-ready) | `ready: custom` (arbitrary shell probe) |
| [`08-fullstack`](08-fullstack) | The lot: preflight, multi-wave deps, webpack parser, filters, hooks, restart, categories |
| [`09-manual-retry`](09-manual-retry) | Partial-boot tolerance, REPL commands (`r`, `r!`, `s`, `q`), cascade restart, auto-unblock pending |
| [`10-mcp`](10-mcp) | Built-in MCP server: `mcp:` YAML block, `claude mcp add --transport http`, the three read-only tools |
| [`11-docker`](11-docker) | `type: docker` + `container_name` — auto orphan-cleanup before spawn, auto `docker rm -f` on shutdown |
| [`12-angular`](12-angular) | `type: angular` — real `ng serve` app, build-output parser, `ready: http` |

Run any example:

```bash
orc validate -c examples/<dir>/orckit.yaml    # parse config + print graph
orc start    -c examples/<dir>/orckit.yaml --show-output
```

Examples with a `package.json` install their dependencies the first time you
run them via the configured `pre_start` hook — no manual `pnpm install` step.
