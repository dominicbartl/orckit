# 13 — worktree sandboxes

The same stack (a redis container + a Node API) running once per git
worktree, each in its own OrbStack container with its own hostname — so every
worktree serves `:3000` and `:6379` at the same time.

**Features:** `sandbox:` block, `copy_files`, `type: docker` inside a sandbox,
a localhost-bound server reached via the sandbox hostname,
`orc sandbox list | stop | rm | prune`.

Requires macOS with [OrbStack](https://orbstack.dev) as the Docker engine.

```bash
# The ignored file copy_files brings into each worktree:
echo "SECRET=from-main" > examples/13-sandbox/.env.local

git worktree add ../demo-a && git worktree add ../demo-b

(cd ../demo-a && orc start -c examples/13-sandbox/orckit.yaml)   # terminal 1
(cd ../demo-b && orc start -c examples/13-sandbox/orckit.yaml)   # terminal 2

curl http://demo-a.sandbox-demo.local:3000   # hello from orckit-sandbox-demo-demo-a — SECRET=from-main
curl http://demo-b.sandbox-demo.local:3000   # hello from orckit-sandbox-demo-demo-b — SECRET=from-main
orc sandbox list
```

The first start builds orckit's base image (a few minutes, once). Ctrl-C
stops a sandbox with the normal graceful teardown; `orc start` in the main
checkout runs the same config natively, next to both sandboxes.
