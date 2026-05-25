# 11 — docker process type

A `postgres:16` container managed by orckit through `type: docker`. The
container is auto-cleaned both before spawn (orphans from prior runs) and
on shutdown (Ctrl-C), so no `stop_command` is needed.

**Features:** `type: docker`, `container_name`, `preflight`, `ready: tcp`.

Requires Docker (or a compatible runtime — Colima, OrbStack, Rancher
Desktop, etc.) running on `5439`.

```bash
orc start -c examples/11-docker/orckit.yaml
```

Try this to see the orphan cleanup in action:

```bash
# Start, then Ctrl-C — but force-kill orckit with kill -9 before it shuts
# down so the container is left behind. The next `orc start` will clean it
# up and start fresh without "container name already in use" errors.
docker ps --filter name=orckit-example-pg
```

For shapes outside the single-container case (`docker compose up`,
multi-container workflows), keep `type: bash` and set `stop_command`
explicitly — see [`03-database-and-api`](../03-database-and-api) for the
pattern.
