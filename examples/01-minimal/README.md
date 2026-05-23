# 01 — minimal

The smallest useful Orckit config: two one-shot processes wired by `depends_on`,
each ready when it exits with code 0.

**Features:** `depends_on`, `ready: exit-code`.

```bash
orc start -c examples/01-minimal/orckit.yaml
```
