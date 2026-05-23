# 09 — manual retry

Shows the interactive REPL: when a process fails (initial-boot failure or
runtime crash), Orckit keeps the orchestrator alive and you can fix the
underlying issue then type `r <name>` to retry. By default a retry **cascades**
— all transitive dependents are restarted in dependency order, and any
processes that were stuck `pending` (because their deps had failed) come up
once their deps reach `ready`.

**Features:** `boot:complete` summary, REPL commands (`r`, `r!`, `s`, `q`,
`?`), partial-boot tolerance, cascade restart, auto-unblock pending.

```bash
rm -f /tmp/orckit-demo-flag
orc start -c examples/09-manual-retry/orckit.yaml
```

You'll see `flaky` exhaust its 2 auto-retries, then a summary:

```
  1 ready  1 failed (flaky)  1 pending (dependent)
  type `r flaky` to retry, ? for help
>
```

In another terminal:

```bash
touch /tmp/orckit-demo-flag
```

Then at the orckit prompt:

```
> r flaky
```

`flaky` comes up; cascade automatically restarts `dependent` so it picks up a
fresh connection.

## Commands

| input | meaning |
|---|---|
| `r` | retry every currently-failed process (with cascade) |
| `r <name> [name...]` | retry the listed processes (with cascade) |
| `r! <name>` | retry without cascading to dependents |
| `s` | print current status table |
| `q` | quit (same as Ctrl-C) |
| `?` or `h` | help |

## When the REPL is unavailable

If stdin is not a TTY (e.g. you piped output, or you're in CI), the REPL is
skipped silently. The orchestrator still runs and the summary still prints —
you just can't type commands. Use `--no-repl` to force-disable even in a TTY.
