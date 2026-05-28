# 05 — preflight and hooks

Preflight checks gate the whole run; lifecycle hooks fire before and after each
process's start and stop.

**Features:** `preflight`, `hooks.pre_start`, `hooks.post_start`,
`hooks.pre_stop`, `hooks.post_stop`.

```bash
orc start -c examples/05-preflight-and-hooks/orckit.yaml
```

Orckit announces each hook as it fires with a `↪ <name> <hook> hook` line, so
you'll watch all four go by in lifecycle order: `pre_start` before the spawn,
`post_start` once the process is ready, `pre_stop` before SIGTERM on shutdown,
and `post_stop` after it exits. (The hook command's own stdout isn't streamed —
the `echo`s in the config are just illustrative stand-ins for real work like
`pnpm install` or a DB migration.)

Try forcing a preflight failure by editing one of the `command:` lines to
something that exits non-zero — Orckit will print the failing check + the
`on_fail` hint and never start the service.
