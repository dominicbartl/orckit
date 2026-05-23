# 04 — log-pattern

A long-running worker whose readiness is signalled by a line in stdout. Also
shows how to filter and colorize the captured output stream.

**Features:** `ready: log-pattern`, `output.suppress`, `output.highlight`,
`output.include` (commented out — uncomment to try).

```bash
orc start -c examples/04-log-pattern/orckit.yaml --show-output
```

Notice that `DEBUG:` lines never reach the terminal — they're dropped by the
suppress filter before being buffered.
