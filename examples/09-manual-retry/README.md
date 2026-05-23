# 09 — manual retry

Shows opt-in fix-and-retry. By default Orckit aborts `orc start` (exit 1) the
moment any process fails to boot. Add `manual_retry: true` to a process and
Orckit instead keeps the orchestrator alive, leaves the process in `failed`
state with any dependents `pending`, and prompts you to retry at the
interactive REPL. By default a retry **cascades** — all transitive dependents
are restarted in dependency order, and any processes that were stuck `pending`
come up once their deps reach `ready`.

Typical use: a process that requires external infrastructure you control
locally (Docker daemon, VPN, port-forward, USB device) — fail-fast is wrong
because the fix is "start the thing yourself, then continue".

**Features:** `manual_retry: true`, `boot:complete` summary, REPL commands
(`r`, `r!`, `s`, `q`, `?`), partial-boot tolerance, cascade restart,
auto-unblock pending.

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

## What happens without `manual_retry: true`

Drop the `manual_retry: true` line from `flaky` in the YAML and run the
example again with the flag still missing:

```
✗ flaky failed: exited (code 1)
✗ boot failed: flaky
   (mark these processes `manual_retry: true` in the config to opt into
   fix-and-retry behavior instead of aborting on failure)
```

`orc start` exits 1 immediately — no prompt, no waiting.
