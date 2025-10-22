# Hooks

Hooks allow you to run commands before and after process lifecycle events.

## Process Hooks

Run commands at specific points in a process lifecycle.

```yaml
processes:
  api:
    category: backend
    command: "npm run dev"
    hooks:
      pre_start: "npm install"           # Before starting
      post_start: "curl -X POST http://localhost:3000/init"  # After ready
      pre_stop: "npm run cleanup"        # Before stopping
      post_stop: "rm -rf .cache"         # After stopped
```

### Hook Execution Order

1. **pre_start**: Runs before the process starts
2. Process starts
3. Health check waits for ready
4. **post_start**: Runs after process is ready
5. ... process runs ...
6. **pre_stop**: Runs before stopping the process
7. Process stops
8. **post_stop**: Runs after process has stopped

## Global Hooks

Run commands for all processes.

```yaml
hooks:
  pre_start_all: "./scripts/check-dependencies.sh"
  post_start_all: "echo 'All services ready!'"
  pre_stop_all: "./scripts/backup.sh"
  post_stop_all: "echo 'Cleanup complete'"
```

### Global Hook Execution

- **pre_start_all**: Runs once before any process starts
- **post_start_all**: Runs once after all processes are ready
- **pre_stop_all**: Runs once before any process stops
- **post_stop_all**: Runs once after all processes have stopped

## Use Cases

### Install Dependencies

```yaml
hooks:
  pre_start: "npm install"
```

### Run Database Migrations

```yaml
processes:
  api:
    hooks:
      pre_start: "npm run migrate"
```

### Initialize Application

```yaml
processes:
  api:
    hooks:
      post_start: "curl -X POST http://localhost:3000/api/init"
```

### Cleanup

```yaml
processes:
  build:
    hooks:
      post_stop: "rm -rf dist/"
```

### Backup Data

```yaml
hooks:
  pre_stop_all: "./scripts/backup-database.sh"
```

## Hook Failures

- If a hook fails (exits with non-zero code), the operation stops
- Failed `pre_start` hooks prevent the process from starting
- Failed `post_start` hooks mark the process as failed
- Failed `pre_stop` hooks prevent graceful shutdown

## Best Practices

1. **Keep hooks fast**: Long-running hooks delay startup/shutdown
2. **Make hooks idempotent**: They may run multiple times
3. **Use absolute paths**: Or ensure correct working directory
4. **Handle failures gracefully**: Exit with appropriate codes
5. **Log hook output**: For debugging and monitoring
