# 12 — angular dev server

A real, minimal Angular app (`ng new --minimal`) served by the Angular CLI dev
server and managed by orckit through `type: angular`.

**Features:** `type: angular` (build-output parser), `ready: http`,
`hooks.pre_start` install, `env`.

`type: angular` turns `ng serve`'s output into build events: orckit parses the
`Building...` and `Application bundle generation complete` lines into
`build:start` / `build:complete` and the dashboard annotates the process row
(`building` → `built`). The `http` ready check then waits for the dev server to
answer on `http://localhost:4200/` before the process is marked ready.

```bash
orc start -c examples/12-angular/orckit.yaml
```

The first run installs the Angular toolchain (`@angular/cli` + friends) via the
`pre_start` hook — that's slow on a cold cache. Subsequent runs reuse
`node_modules` and boot in a couple of seconds.

Once it's up, open <http://localhost:4200/> and edit `src/app/app.ts` — the dev
server rebuilds and the dashboard shows the row flip back to `building` then
`built`.

This is a standalone Angular project, so you can also work with it directly:

```bash
cd examples/12-angular
pnpm install --ignore-workspace
pnpm ng serve
```
