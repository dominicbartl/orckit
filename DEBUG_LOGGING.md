# Debug Logging in Orckit

Orckit includes a comprehensive debug logging system to help you understand what's happening during orchestration.

## Quick Start

### Enable Debug Logging

There are several ways to enable debug logging:

#### 1. CLI Flag
```bash
orc start --debug
# or shorthand:
orc start -d
```

#### 2. Environment Variable
```bash
# Enable debug logging
export ORCKIT_DEBUG=1
orc start

# Or inline:
ORCKIT_DEBUG=1 orc start
```

#### 3. Using DEBUG environment variable (compatible with debug package)
```bash
DEBUG=* orc start
```

### Set Log Level

Control the verbosity of debug output:

```bash
# Via CLI flag
orc start --debug --log-level DEBUG

# Via environment variable
ORCKIT_LOG_LEVEL=DEBUG orc start --debug

# Available levels: DEBUG, INFO, WARN, ERROR
```

## Log Levels

| Level | Description | When to Use |
|-------|-------------|-------------|
| `DEBUG` | Most verbose, shows all internal operations | Troubleshooting, understanding flow |
| `INFO` | Shows important operations and milestones | Normal debugging, understanding what's happening |
| `WARN` | Shows warnings and potential issues | Monitoring for problems |
| `ERROR` | Only shows errors | Production, critical issues only |

## Example Output

### With `--debug --log-level DEBUG`:

```
[10:30:45.123] [DEBUG] [Orchestrator] Initializing orchestrator
[10:30:45.125] [DEBUG] [Orchestrator] Loading config from path { path: './orckit.yaml' }
[10:30:45.130] [INFO] [Orchestrator] Config loaded {
  "project": "my-app",
  "processCount": 5
}
[10:30:45.132] [DEBUG] [Orchestrator] ⏱️  Dependency resolution started
[10:30:45.135] [DEBUG] [Orchestrator] ⏱️  Dependency resolution completed in 3ms
[10:30:45.136] [INFO] [Orchestrator] Dependency resolution complete {
  "startOrder": ["postgres", "redis", "api", "worker", "web"]
}
[10:30:45.140] [INFO] [Orchestrator] Starting orchestration {
  "requestedProcesses": null,
  "actualProcesses": ["postgres", "redis", "api", "worker", "web"]
}
[10:30:45.145] [DEBUG] [Orchestrator] Running preflight checks
[10:30:45.200] [INFO] [Orchestrator] Preflight checks passed
[10:30:45.210] [DEBUG] [Orchestrator] Creating tmux session
[10:30:45.350] [INFO] [Orchestrator] Tmux session created
[10:30:45.352] [INFO] [Orchestrator] Processes grouped into waves {
  "waveCount": 3,
  "waves": [
    { "wave": 1, "processes": ["postgres", "redis"] },
    { "wave": 2, "processes": ["api"] },
    { "wave": 3, "processes": ["worker", "web"] }
  ]
}
[10:30:45.355] [INFO] [Orchestrator] Starting wave 1/3 {
  "processes": ["postgres", "redis"]
}
[10:30:45.360] [INFO] [Orchestrator] Starting process: postgres {
  "type": "docker",
  "category": "infrastructure",
  "command": "docker run...",
  "dependencies": []
}
[10:30:45.365] [DEBUG] [Orchestrator] Creating runner for postgres { "type": "docker" }
[10:30:45.368] [DEBUG] [Orchestrator] Runner created for postgres
[10:30:45.370] [DEBUG] [Orchestrator] Starting runner for postgres
[10:30:47.850] [INFO] [Orchestrator] Runner for postgres started successfully
[10:30:47.852] [DEBUG] [Orchestrator] Process postgres PID { "pid": 12345 }
[10:30:47.853] [DEBUG] [Orchestrator] ⏱️  Process postgres startup completed in 2.493s
[10:30:47.855] [INFO] [Orchestrator] Process postgres is ready
[10:30:47.860] [INFO] [Orchestrator] Wave 1 completed
```

### With `--debug --log-level INFO`:

```
[10:30:45.130] [INFO] [Orchestrator] Config loaded {
  "project": "my-app",
  "processCount": 5
}
[10:30:45.136] [INFO] [Orchestrator] Dependency resolution complete {
  "startOrder": ["postgres", "redis", "api", "worker", "web"]
}
[10:30:45.200] [INFO] [Orchestrator] Preflight checks passed
[10:30:45.350] [INFO] [Orchestrator] Tmux session created
[10:30:45.352] [INFO] [Orchestrator] Processes grouped into waves {
  "waveCount": 3,
  "waves": [...]
}
[10:30:45.355] [INFO] [Orchestrator] Starting wave 1/3 { "processes": ["postgres", "redis"] }
[10:30:47.850] [INFO] [Orchestrator] Runner for postgres started successfully
[10:30:47.855] [INFO] [Orchestrator] Process postgres is ready
```

## What Gets Logged

### Orchestrator
- Configuration loading and validation
- Dependency resolution (with timing)
- Preflight check results
- Tmux session creation
- Wave-based startup (which processes start in each wave)
- Individual process startup
- Process status changes
- Build progress and metrics
- PID assignment
- Restart attempts
- Errors and failures

### Components Currently Instrumented

1. **Orchestrator** ✅
   - Initialization
   - Configuration loading
   - Dependency resolution
   - Process startup (wave-by-wave)
   - Status monitoring
   - Tmux integration

2. **CLI** ✅
   - Debug flag parsing
   - Log level configuration
   - Command execution

### Coming Soon

Additional components will receive debug logging:
- Process Runners (Angular, Node, Webpack, etc.)
- Dependency Resolution internals
- Health Check system
- Tmux Manager operations

## Use Cases

### 1. Understanding Startup Order
```bash
orc start --debug --log-level INFO 2>&1 | grep "wave"
```

### 2. Debugging Slow Startup
```bash
orc start --debug --log-level DEBUG 2>&1 | grep "⏱️"
```

### 3. Tracking Process Status Changes
```bash
orc start --debug --log-level DEBUG 2>&1 | grep "status changed"
```

### 4. Monitoring Build Progress
```bash
orc start --debug --log-level DEBUG 2>&1 | grep "build progress"
```

### 5. Investigating Failures
```bash
orc start --debug --log-level ERROR
```

## Output Format

Each log line follows this format:

```
[HH:mm:ss.SSS] [LEVEL] [Component] Message { "data": "..." }
```

- **Timestamp**: Millisecond precision for timing analysis
- **Level**: DEBUG, INFO, WARN, or ERROR (color-coded)
- **Component**: Which part of Orckit is logging (e.g., Orchestrator, Runner, etc.)
- **Message**: Human-readable description
- **Data**: Structured JSON data (optional)

## Programmatic Usage

If you're extending Orckit or building on top of it, you can use the debug logger:

```typescript
import { createDebugLogger } from '@orckit/cli/utils/logger.js';

const debug = createDebugLogger('MyComponent');

// Basic logging
debug.debug('Something happened');
debug.info('Important milestone');
debug.warn('Potential issue');
debug.error('Something failed');

// With data
debug.info('Process started', { name: 'api', pid: 12345 });

// Timing operations
const endTimer = debug.time('My Operation');
// ... do work ...
endTimer(); // Logs duration automatically

// Grouping related operations
debug.group('Initialization', () => {
  debug.debug('Step 1');
  debug.debug('Step 2');
  debug.debug('Step 3');
});
```

## Performance Considerations

- Debug logging has **minimal performance impact** when disabled
- When enabled, logging is synchronous but optimized
- JSON serialization only happens when the log level permits
- Timestamps use efficient date formatting

## Filtering Debug Output

### Save debug logs to a file
```bash
orc start --debug 2>&1 | tee debug.log
```

### Filter by component
```bash
orc start --debug 2>&1 | grep "\[Orchestrator\]"
```

### Filter by log level
```bash
orc start --debug 2>&1 | grep "\[ERROR\]"
```

### Combine with other tools
```bash
# Show only timing information
orc start --debug 2>&1 | grep "⏱️"

# Show wave information with timestamps
orc start --debug 2>&1 | grep "wave" | cut -d']' -f1,4-
```

## Tips

1. **Start with INFO level** - It provides good visibility without being overwhelming
2. **Use DEBUG for specific issues** - When you need to understand exactly what's happening
3. **Capture logs to a file** - Makes it easier to analyze complex issues
4. **Use grep patterns** - Filter logs to focus on specific components or operations
5. **Check timing** - Use `⏱️` emoji to find slow operations

## Troubleshooting

### Debug logging not showing?

1. Check that you've enabled it:
   ```bash
   orc start --debug
   # or
   ORCKIT_DEBUG=1 orc start
   ```

2. Check your log level:
   ```bash
   orc start --debug --log-level DEBUG
   ```

3. Verify the CLI version supports debug logging:
   ```bash
   orc --version
   ```

### Too much output?

Increase the log level:
```bash
orc start --debug --log-level WARN  # Only warnings and errors
orc start --debug --log-level ERROR # Only errors
```

### Want to debug a specific component?

Use grep to filter:
```bash
orc start --debug 2>&1 | grep "\[ComponentName\]"
```

## Contributing

When adding new debug logging:

1. Create a logger for your component:
   ```typescript
   const debug = createDebugLogger('MyComponent');
   ```

2. Use appropriate log levels:
   - `DEBUG`: Internal state, detailed flow
   - `INFO`: Major operations, milestones
   - `WARN`: Potential issues, retries
   - `ERROR`: Failures, exceptions

3. Include relevant data:
   ```typescript
   debug.info('Operation completed', { duration: 123, items: 45 });
   ```

4. Use timing for performance tracking:
   ```typescript
   const endTimer = debug.time('Expensive operation');
   // ... work ...
   endTimer();
   ```

5. Keep messages concise and actionable
