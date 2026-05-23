# 07 — custom ready check

When `http` / `tcp` / `log-pattern` don't fit, `custom` runs an arbitrary shell
command and waits for it to exit 0. Here the server simulates a 3-second warm-up
and the probe `curl`s a `/ready` endpoint until it returns 200.

**Features:** `ready: custom`, `interval_ms`, `hooks.pre_start`.

```bash
orc start -c examples/07-custom-ready/orckit.yaml --show-output
```

Requires `curl` on `$PATH`.
