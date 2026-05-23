# Examples

| File | What it shows |
|---|---|
| [`minimal.yaml`](minimal.yaml) | Two one-shot processes with `depends_on` and `exit-code` ready checks. |
| [`counter.yaml`](counter.yaml) | Two long-running processes that emit output, gated by `log-pattern` ready checks. |
| [`fullstack.yaml`](fullstack.yaml) | Docker infra → API (HTTP ready) → web (webpack parser). Shows hooks, output filtering, preflight. |

Run any example:

```bash
orc start -c examples/minimal.yaml
```

Validate first if you just want to see the resolved dependency order:

```bash
orc validate -c examples/fullstack.yaml
```
