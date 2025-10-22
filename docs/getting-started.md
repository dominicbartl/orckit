# Getting Started with Orckit

This guide will help you get started with Orckit in just a few minutes.

## Installation

```bash
pnpm add -g @orckit/cli
```

Verify installation:

```bash
orc --version
```

## Prerequisites

- Node.js >= 18.0.0
- tmux (for session management): `brew install tmux` (macOS) or `apt-get install tmux` (Linux)
- Docker (optional, for Docker processes)

## Your First Configuration

Create a file named `orckit.yaml`:

```yaml
version: "1"
project: "my-first-app"

processes:
  hello:
    category: main
    command: "echo 'Hello from Orckit!' && sleep 2"
    ready:
      type: exit-code
```

Start your process:

```bash
orc start
```

You should see:
```
🎭 Orckit - Starting processes...

  ⚙  Starting hello...
  ✓  hello ready (2000ms)

✓  All processes started successfully!
```

## Next Steps

1. [Configuration Reference](configuration.md) - Learn all configuration options
2. [Process Types](process-types.md) - Explore different process types
3. [Health Checks](health-checks.md) - Configure ready checks
4. [CLI Reference](cli-reference.md) - Master the CLI
