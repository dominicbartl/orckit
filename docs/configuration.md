# Configuration Reference

Complete reference for `orckit.yaml` configuration files.

## Top-Level Structure

```yaml
version: "1"              # Config version (required)
project: "name"           # Project name (optional)
categories: {}            # Window categories (optional)
processes: {}             # Process definitions (required)
hooks: {}                 # Global hooks (optional)
preflight: {}             # Preflight checks (optional)
maestro: {}               # Boot configuration (optional)
```

## Processes

Each process must have a unique name and configuration:

```yaml
processes:
  process_name:
    category: string           # tmux window category (required)
    type: ProcessType          # Process type (optional, default: bash)
    command: string            # Command to execute (required)
    cwd: string               # Working directory (optional)
    dependencies: []           # Dependency list (optional)
    restart: RestartPolicy     # Restart policy (optional, default: on-failure)
    restart_delay: string      # Delay before restart (optional, default: 5s)
    max_retries: number        # Max restart attempts (optional, default: 3)
    env: {}                   # Environment variables (optional)
    ready: ReadyCheck          # Health check (optional)
    output: OutputConfig       # Log configuration (optional)
    hooks: ProcessHooks        # Process hooks (optional)
    integration: {}           # Build integration (optional)
    config: string            # Config file path (optional)
    preflight: []             # Custom checks (optional)
```

### Process Types

- `bash` - Shell commands/scripts (default)
- `docker` - Docker containers
- `node` - Node.js applications
- `ts-node` - TypeScript applications
- `webpack` - Webpack with deep integration
- `angular` - Angular CLI with deep integration
- `vite` - Vite dev server
- `build` - Generic build processes

### Restart Policies

- `always` - Always restart on exit
- `on-failure` - Restart only on non-zero exit
- `never` - Never restart

### Ready Checks

See [health-checks.md](health-checks.md) for details.

### Output Configuration

See [output-filtering.md](output-filtering.md) for details.

### Hooks

See [hooks.md](hooks.md) for details.

## Categories

Define tmux windows:

```yaml
categories:
  infrastructure:
    window: "infra"
  backend:
    window: "backend"
  frontend:
    window: "frontend"
```

## Global Hooks

```yaml
hooks:
  pre_start_all: "command"   # Before starting any process
  post_start_all: "command"  # After all processes started
  pre_stop_all: "command"    # Before stopping any process
  post_stop_all: "command"   # After all processes stopped
```

## Preflight Checks

```yaml
preflight:
  checks:
    - name: "check_name"
      command: "test -d ./node_modules"
      error: "Dependencies not installed"
      fix: "Run: npm install"
```

## Boot Configuration

```yaml
maestro:
  boot:
    style: timeline                 # timeline | dashboard | minimal | quiet
    show_preflight: true           # Show preflight checks
    show_graph: true               # Show dependency graph
    show_progress_bars: true       # Show progress bars
    show_hooks: true               # Show hook execution
    show_timing: true              # Show timing information
    collapse_successful: false     # Hide successful steps
```

## Complete Example

See [examples/simple.yaml](../examples/simple.yaml) for a complete working example.
