# CLI Reference

Complete reference for all Orckit CLI commands.

## Global Options

- `-V, --version` - Output the version number
- `-h, --help` - Display help for command

## Commands

### `orc start [processes...]`

Start all processes or specific processes.

**Arguments:**
- `processes...` - Optional list of process names to start (default: all)

**Options:**
- `-c, --config <path>` - Path to configuration file (default: `./orckit.yaml`)

**Examples:**
```bash
# Start all processes
orc start

# Start specific processes
orc start api frontend

# Use custom config file
orc start -c custom.yaml
```

### `orc stop [processes...]`

Stop running processes.

**Arguments:**
- `processes...` - Optional list of process names to stop (default: all)

**Options:**
- `-c, --config <path>` - Path to configuration file (default: `./orckit.yaml`)

**Examples:**
```bash
# Stop all processes
orc stop

# Stop specific processes
orc stop api worker
```

### `orc restart <processes...>`

Restart one or more processes.

**Arguments:**
- `processes...` - List of process names to restart (required)

**Options:**
- `-c, --config <path>` - Path to configuration file (default: `./orckit.yaml`)

**Examples:**
```bash
# Restart single process
orc restart api

# Restart multiple processes
orc restart api worker frontend
```

### `orc status`

Show status of all processes.

**Options:**
- `-c, --config <path>` - Path to configuration file (default: `./orckit.yaml`)

**Example:**
```bash
orc status
```

Output:
```
📊 Process Status:

  🟢 postgres     running
  🟢 api          running
  ⚪ frontend     stopped
```

### `orc list`

List all defined processes with their configuration.

**Options:**
- `-c, --config <path>` - Path to configuration file (default: `./orckit.yaml`)

**Example:**
```bash
orc list
```

### `orc validate`

Validate configuration file and show dependency graph.

**Options:**
- `-c, --config <path>` - Path to configuration file (default: `./orckit.yaml`)

**Example:**
```bash
orc validate
```

Output shows:
- Configuration validity
- Startup order
- Dependency graph

### `orc logs <process>`

View logs for a specific process.

**Arguments:**
- `process` - Process name (required)

**Options:**
- `-f, --follow` - Follow log output (like `tail -f`)
- `-c, --config <path>` - Path to configuration file (default: `./orckit.yaml`)

**Examples:**
```bash
# View logs
orc logs api

# Follow logs
orc logs api --follow
```

### `orc attach <process>`

Attach to a process's tmux pane.

**Arguments:**
- `process` - Process name (required)

**Options:**
- `-c, --config <path>` - Path to configuration file (default: `./orckit.yaml`)

**Example:**
```bash
orc attach api
```

### `orc completion`

Generate shell completion script.

**Example:**
```bash
# Install completion for current shell
eval "$(orc completion)"

# Or add to shell config
echo 'eval "$(orc completion)"' >> ~/.bashrc
```

## Exit Codes

- `0` - Success
- `1` - Error (configuration invalid, process failed, etc.)
- `2` - Usage error (invalid arguments, etc.)

## Configuration File

By default, Orckit looks for configuration in:
1. `./orckit.yaml`
2. `./orckit.yml`
3. `./.orckit/config.yaml`

Use `-c` to specify a custom path.
