# Contributing to Orckit

## Setup

```bash
git clone https://github.com/YOUR_USERNAME/orckit.git
cd orckit
pnpm install
pnpm test
```

Requires Node 20+ and pnpm 10+.

## Workflow

```bash
pnpm typecheck
pnpm test               # all tests
pnpm test:watch         # iterative
pnpm test:integration   # spawns real bash processes
pnpm lint
pnpm build
```

## Architecture

See [CLAUDE.md](CLAUDE.md). One responsibility per file, no inheritance in the runner, the schema is the source of truth for types, the orchestrator emits events while the reporter renders.

Before adding a new feature, find the section it belongs to in CLAUDE.md ("Adding a new feature"). If your change doesn't fit one of those slots, please open an issue first to discuss.

## Tests

Every change touching `src/` needs tests in the mirroring `tests/` location. Pure code → unit test. Anything that needs a real process or socket → `tests/integration/`. Aim for the coverage thresholds in `vitest.config.ts` (lines/functions ≥ 80%, branches ≥ 75%).

## Commit style

Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Keep the subject under 70 chars; put rationale in the body.

## Pull requests

1. Branch from `main`.
2. Make sure `pnpm typecheck && pnpm test && pnpm lint` is clean.
3. Update README.md / CLAUDE.md if behavior or structure changes.
4. Open the PR with a brief description of the change and any tradeoffs.
