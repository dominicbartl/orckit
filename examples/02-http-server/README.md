# 02 — http-server

A single Node HTTP server with an `/health` endpoint. The `pre_start` hook runs
`pnpm install` so the example bootstraps itself before the server starts.

**Features:** `ready: http`, `env`, `cwd`, `hooks.pre_start`, `output.highlight`,
`restart: on-failure`, `max_retries`.

```bash
orc start -c examples/02-http-server/orckit.yaml --show-output
```

Open <http://localhost:3001/health> to see the server respond.
