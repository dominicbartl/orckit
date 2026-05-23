# 03 — database-and-api

A two-tier stack: a stand-in "database" (TCP server on port 5432) and an API
that proves the dependency was honored by probing the db on each `/health` hit.

**Features:** `ready: tcp`, `ready: http`, `depends_on`, `category` grouping,
`env` passing host/port between services.

```bash
orc start -c examples/03-database-and-api/orckit.yaml --show-output
```

Then `curl localhost:3002/health` to see the API confirm the db is reachable.
