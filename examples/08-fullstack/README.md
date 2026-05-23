# 08 — fullstack

A realistic local-dev stack combining most Orckit features in one config.

```
              db (TCP :5433)
                  │
                  ▼
              api (HTTP :3004)
              ╱            ╲
       worker (log)      web (webpack-parsed log :3005)
```

**Features:** `preflight`, `ready: tcp` / `http` / `log-pattern`, `depends_on`
graph with parallel waves, `category` grouping, `type: webpack` build parser,
`hooks.pre_start` / `hooks.post_start`, `output.suppress` / `output.highlight`,
`restart: on-failure` + `max_retries`, `buffer_size`, per-service `cwd` and
`env`.

```bash
orc validate -c examples/08-fullstack/orckit.yaml         # print graph
orc start -c examples/08-fullstack/orckit.yaml --show-output --show-build
```

The `api/` and `web/` subdirectories are independent pnpm projects; their
respective `pre_start` hooks run `pnpm install --silent` so the example
bootstraps itself the first time you run it.

Start just one slice and its dependencies:

```bash
orc start api -c examples/08-fullstack/orckit.yaml        # db + api only
orc start web -c examples/08-fullstack/orckit.yaml        # db + api + web
```
