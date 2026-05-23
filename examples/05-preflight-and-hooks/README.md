# 05 — preflight and hooks

Preflight checks gate the whole run; lifecycle hooks fire before and after each
process's start and stop.

**Features:** `preflight`, `hooks.pre_start`, `hooks.post_start`,
`hooks.pre_stop`, `hooks.post_stop`.

```bash
orc start -c examples/05-preflight-and-hooks/orckit.yaml
```

Try forcing a preflight failure by editing one of the `command:` lines to
something that exits non-zero — Orckit will print the failing check + the
`on_fail` hint and never start the service.
