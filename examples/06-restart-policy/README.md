# 06 — restart policy

A process that always crashes, so you can watch the restart loop fire and then
give up.

**Features:** `restart: on-failure`, `restart_delay_ms`, `max_retries`.

```bash
orc start -c examples/06-restart-policy/orckit.yaml --show-output
```

Other policies: `always` (retry even on clean exits), `never` (no retries).
