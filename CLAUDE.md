# CLAUDE.md - Orckit Architecture & Implementation Guide

This document provides comprehensive context about the Orckit project for AI assistants and developers.

## Project Overview

**Orckit** (`@orckit/cli`) is a CLI tool for orchestrating multiple processes in local development environments. Think of it as a local alternative to docker-compose or Kubernetes, optimized for development workflows with superior visibility through tmux integration.

### Key Concepts

1. **Process Orchestration**: Manages lifecycle of multiple processes (start, stop, restart, health monitoring)
2. **Dependency Management**: Uses topological sorting to determine correct startup order
3. **Health Checks**: Multiple strategies to determine when processes are ready
4. **tmux Integration**: Processes run in organized tmux panes with beautiful themes
5. **Output Management**: Smart filtering and formatting of process logs
6. **Build Tool Integration**: Deep integration with Webpack, Angular CLI, and Vite

## Architecture

### Directory Structure

```
src/
├── cli/              # CLI entry point and commands
│   └── index.ts      # Commander-based CLI
├── core/             # Core orchestration logic
│   ├── config/       # Configuration parsing and validation
│   │   ├── schema.ts # Zod schemas
│   │   └── parser.ts # YAML parsing
│   ├── dependency/   # Dependency resolution
│   │   └── resolver.ts # Topological sort
│   ├── health/       # Health check system
│   │   └── checker.ts # HTTP, TCP, log pattern checkers
│   ├── process/      # Process lifecycle management
│   ├── tmux/         # tmux session management
│   └── orckit.ts     # Main orchestrator class (API)
├── runners/          # Process type implementations
│   ├── base.ts       # Base runner class
│   ├── bash.ts       # Bash/shell runner
│   ├── docker.ts     # Docker container runner
│   ├── node.ts       # Node.js runner
│   ├── webpack.ts    # Webpack with deep integration
│   ├── angular.ts    # Angular CLI with deep integration
│   └── vite.ts       # Vite runner
├── utils/            # Utility functions
│   ├── logger.ts     # Output filtering and formatting
│   └── system.ts     # System utilities
├── types/            # TypeScript type definitions
│   └── index.ts      # All type exports
├── plugins/          # Build tool plugins
│   ├── webpack.ts    # Webpack plugin
│   ├── angular.ts    # Angular builder
│   └── vite.ts       # Vite plugin
└── index.ts          # Main export for programmatic API
```

### Core Components

#### 1. Configuration System (src/core/config/)

**Purpose**: Parse and validate YAML configuration files

**Key Files**:
- `schema.ts`: Zod validation schemas for type-safe configuration
- `parser.ts`: YAML parsing and helper functions

**Configuration Structure**:
```yaml
version: "1"
project: "name"
categories: {}        # tmux window organization
processes: {}         # Process definitions
hooks: {}            # Global hooks
preflight: {}        # Preflight checks
maestro: {}          # Boot configuration
```

**Process Configuration**:
```yaml
process_name:
  category: string           # tmux window category
  type: ProcessType          # bash|docker|node|webpack|angular|vite
  command: string            # Command to execute
  cwd: string               # Working directory
  dependencies: string[]     # Process dependencies
  restart: RestartPolicy     # always|on-failure|never
  restart_delay: string      # e.g., "5s"
  max_retries: number        # Max restart attempts
  env: {}                   # Environment variables
  ready: ReadyCheck          # Health check configuration
  output: OutputConfig       # Log filtering/formatting
  hooks: ProcessHooks        # Pre/post hooks
  integration: {}           # Deep build integration
```

#### 2. Dependency Resolver (src/core/dependency/)

**Purpose**: Determine process startup order using topological sorting (Kahn's algorithm)

**Key Functions**:
- `resolveDependencies(config)`: Returns ordered array of process names
- `groupIntoWaves(config)`: Groups processes that can start in parallel
- `getAllDependencies(config, process)`: Returns transitive dependencies
- `visualizeDependencyGraph(config)`: ASCII visualization

**Algorithm**: Kahn's algorithm for topological sorting
- Detects circular dependencies
- Validates missing dependencies
- Ensures deterministic order

#### 3. Health Check System (src/core/health/)

**Purpose**: Determine when processes are ready

**Health Checker Types**:

1. **HttpHealthChecker**: Polls HTTP endpoint
   ```typescript
   {
     type: 'http',
     url: 'http://localhost:3000/health',
     expectedStatus: 200,
     timeout: 60000,
     interval: 1000,
     maxAttempts: 60
   }
   ```

2. **TcpHealthChecker**: Checks TCP port availability
   ```typescript
   {
     type: 'tcp',
     host: 'localhost',
     port: 5432,
     timeout: 30000
   }
   ```

3. **LogPatternHealthChecker**: Waits for regex pattern in logs
   ```typescript
   {
     type: 'log-pattern',
     pattern: 'Compiled successfully',
     timeout: 120000
   }
   ```

4. **CustomHealthChecker**: Runs custom command
   ```typescript
   {
     type: 'custom',
     command: 'curl -f localhost:3000',
     timeout: 60000
   }
   ```

5. **Exit Code**: Process must exit with code 0 (handled by runner)

#### 4. Process Runners (src/runners/)

**Purpose**: Execute and manage different process types

**Base Class** (`base.ts`):
```typescript
abstract class ProcessRunner extends EventEmitter {
  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  async restart(): Promise<void>;

  // Events: 'status', 'stdout', 'stderr', 'exit', 'failed', 'build:info'
}
```

**Runner Implementations**:
- **BashRunner**: Executes shell commands via `execa`
- **DockerRunner**: Manages Docker containers
- **NodeRunner**: Runs Node.js applications
- **WebpackRunner**: Webpack with custom plugin for real-time stats
- **AngularRunner**: Angular CLI with JSON output parsing
- **ViteRunner**: Vite dev server

**Deep Build Integration**:
- Webpack: Custom plugin injected to report progress, errors, warnings, size
- Angular: Parses `--json` output for structured build events
- Provides real-time build metrics for overview pane

#### 5. Output System (src/utils/logger.ts)

**Purpose**: Filter and format process output

**ProcessLogger Class**:
- Suppression filters (regex patterns to hide)
- Include filters (whitelist mode)
- Highlighting patterns (color coding)
- Timestamp injection
- Custom prefixes
- Line buffering (configurable max lines)

**Color Palette**: Consistent colors per process (hashed from process name)

#### 6. Orchestrator (src/core/orckit.ts)

**Purpose**: Main programmatic API

**Key Methods**:
```typescript
class Orckit extends EventEmitter {
  constructor(options: { configPath?: string; config?: OrckitConfig })

  async start(processNames?: string[]): Promise<void>
  async stop(processNames?: string[]): Promise<void>
  async restart(processNames: string[]): Promise<void>

  getStatus(processName?: string): ProcessStatus | Map<string, ProcessStatus>
  async waitForReady(processName: string, options?: { timeout?: number }): Promise<boolean>

  addProcess(name: string, config: ProcessConfig): void
  async removeProcess(name: string): Promise<void>
}
```

**Events**:
- `process:starting`
- `process:ready`
- `process:running`
- `process:failed`
- `process:stopped`
- `process:restarting`
- `build:start`
- `build:progress`
- `build:complete`
- `build:failed`
- `hook:start`
- `hook:complete`
- `all:ready`

#### 7. CLI (src/cli/index.ts)

**Purpose**: Command-line interface using Commander

**Commands**:
- `orc start [processes...]` - Start processes
- `orc stop [processes...]` - Stop processes
- `orc restart <processes...>` - Restart processes
- `orc status` - Show process statuses
- `orc list` - List all processes
- `orc validate` - Validate configuration
- `orc logs <process>` - View logs
- `orc attach <process>` - Attach to tmux pane
- `orc completion` - Generate shell completions

## Implementation Status

### ✅ Completed Features

1. **Core Infrastructure**
   - TypeScript project setup with pnpm
   - Build pipeline (tsc, tsc-alias)
   - Testing framework (vitest)
   - Linting (eslint, prettier)

2. **Configuration System**
   - YAML parsing
   - Zod validation schemas
   - Complete type definitions
   - Configuration helpers

3. **Dependency Resolution**
   - Topological sorting (Kahn's algorithm)
   - Circular dependency detection
   - Missing dependency validation
   - Wave grouping for parallel starts
   - Dependency visualization

4. **Health Check System**
   - HTTP checker
   - TCP checker
   - Log pattern checker
   - Custom command checker
   - Exit code support (in runners)

5. **Output System**
   - Process logger with filtering
   - Suppression patterns
   - Highlight patterns
   - Include patterns (whitelist)
   - Timestamps and prefixes
   - Color palette
   - Formatting utilities

6. **Process Runners**
   - Base runner class with EventEmitter
   - Bash runner implementation
   - Runner interface defined

7. **System Utilities**
   - Command existence checking
   - Port availability checking
   - Docker daemon detection
   - tmux availability checking
   - Process tree killing
   - Environment merging

8. **Programmatic API**
   - Orckit orchestrator class
   - Event-driven architecture
   - Process control methods
   - Status querying
   - Dynamic process management

9. **CLI**
   - All command implementations
   - Config file loading
   - Event listeners
   - Status display
   - Validation command
   - List command

10. **Documentation**
    - Comprehensive README
    - CLAUDE.md (this file)
    - Example configurations

11. **Build & Testing**
    - Project builds successfully
    - CLI commands work
    - Validation works
    - Dependency resolution tested

### 🚧 Partially Implemented / TODO

1. **Process Runners** (Need full implementation)
   - Docker runner
   - Node/TypeScript runner
   - Webpack runner with plugin
   - Angular runner with JSON parsing
   - Vite runner

2. **Hooks System**
   - Hook execution framework
   - Pre/post lifecycle hooks
   - Global hooks
   - Hook event emission

3. **Preflight Checks**
   - Preflight check framework
   - Built-in checks (tmux, docker, node, ports)
   - Custom checks from config
   - Check result display in boot sequence

4. **tmux Integration**
   - Session manager
   - Custom theme configuration
   - Window/pane management
   - Overview pane with live stats
   - Integrated terminal pane
   - Keyboard shortcuts

5. **Boot Logger**
   - Timeline style
   - Dashboard style
   - Minimal style
   - Progress bars
   - Live updates
   - Colored output

6. **Status Monitoring**
   - Real-time status aggregation
   - Resource usage (CPU/memory)
   - Build metrics display
   - Overview pane updates

7. **Build Tool Plugins**
   - Webpack plugin (`@orckit/cli/webpack`)
   - Angular builder (`@orckit/cli/angular`)
   - Vite plugin (`@orckit/cli/vite`)

8. **CLI Features**
   - Log viewing (`orc logs`)
   - tmux attach (`orc attach`)
   - Shell autocomplete (omelette)

9. **Tests**
   - Unit tests for all modules
   - Integration tests
   - E2E tests
   - Test fixtures
   - Coverage >80%

10. **Additional Documentation**
    - Getting started guide
    - Complete configuration reference
    - Process types guide
    - Health checks guide
    - Hooks guide
    - Output filtering guide
    - tmux integration guide
    - CLI reference
    - Programmatic API docs
    - Build integration docs
    - Troubleshooting guide

## Design Decisions

### Why tmux?

tmux provides:
- Persistent sessions that survive terminal disconnect
- Organized window/pane layout
- Easy navigation between processes
- Native terminal experience
- Lightweight and ubiquitous on Unix systems

### Why Topological Sorting?

Kahn's algorithm ensures:
- Correct dependency order
- Circular dependency detection
- Deterministic startup sequence
- Ability to identify parallel start opportunities

### Why Zod for Validation?

Zod provides:
- Type inference (TypeScript types from schema)
- Runtime validation
- Excellent error messages
- Composable schemas
- Default value support

### Why EventEmitter for API?

EventEmitter allows:
- Reactive programming model
- Multiple listeners per event
- Easy integration with build tools
- Standard Node.js pattern
- Type-safe with TypeScript

### Why Multiple Health Check Types?

Different processes signal readiness differently:
- HTTP services expose health endpoints
- Databases accept TCP connections
- Build tools print success messages
- Scripts exit with status codes
- Custom checks for unique scenarios

## Key Files Reference

### Most Important Files

1. **src/types/index.ts** - All TypeScript type definitions
2. **src/core/config/schema.ts** - Zod schemas for validation
3. **src/core/dependency/resolver.ts** - Dependency resolution logic
4. **src/core/health/checker.ts** - Health check implementations
5. **src/core/orckit.ts** - Main orchestrator API
6. **src/cli/index.ts** - CLI entry point
7. **src/utils/logger.ts** - Output filtering and formatting
8. **src/utils/system.ts** - System utility functions

### Configuration Examples

See `examples/` directory:
- `minimal.yaml` - Simplest possible config
- `simple.yaml` - Full-stack example with all features

## Testing Strategy

### Unit Tests

Test individual components in isolation:
- Config parser with various YAML inputs
- Dependency resolver with different graphs
- Health checkers with mocked services
- Logger with different filter configurations
- System utilities with mocked commands

### Integration Tests

Test component interactions:
- Full process lifecycle (start → ready → stop)
- Dependency chain execution
- Health check → ready state transition
- Hook execution in lifecycle
- Event emission flow

### E2E Tests

Test complete workflows:
- Start simple project
- Handle failures and restarts
- Validate circular dependency error
- Test tmux session creation
- Verify build tool integration

## Future Enhancements

1. **Web UI**: Optional web dashboard for GUI lovers
2. **Profiles**: Named process sets (e.g., `orc start --profile=backend-only`)
3. **Secret Management**: Integration with vaults
4. **Performance Metrics**: Detailed CPU/memory tracking
5. **Remote Monitoring**: WebSocket-based remote status viewing
6. **Plugin System**: User-defined custom runners
7. **Configuration Validation**: IDE integration for YAML validation
8. **Process Groups**: Logical grouping beyond categories
9. **Conditional Starts**: Environment-based process filtering
10. **Log Aggregation**: Centralized searchable logs

## Contributing Guidelines

When working on Orckit:

1. **Type Safety**: Use strict TypeScript, avoid `any`
2. **Event-Driven**: Emit events for all lifecycle changes
3. **Error Handling**: Throw descriptive errors with context
4. **Testing**: Write tests for new features
5. **Documentation**: Update docs for user-facing changes
6. **Backwards Compat**: Don't break existing configs
7. **Performance**: Keep startup time low
8. **Colors**: Use chalk for terminal colors
9. **Async/Await**: Prefer async/await over callbacks
10. **Comments**: JSDoc for public APIs

## Common Development Tasks

### Adding a New Process Type

1. Create runner in `src/runners/newtype.ts`
2. Extend `ProcessRunner` base class
3. Implement `start()` and `stop()` methods
4. Emit events: `status`, `stdout`, `stderr`, `exit`, `failed`
5. Add type to `ProcessType` enum in `src/types/index.ts`
6. Update schema in `src/core/config/schema.ts`
7. Add example to `examples/`
8. Document in `docs/process-types.md`
9. Write tests

### Adding a New Health Check Type

1. Create interface in `src/types/index.ts`
2. Create checker class in `src/core/health/checker.ts`
3. Implement `HealthChecker` interface
4. Add to discriminated union in schema
5. Update `createHealthChecker()` factory
6. Add example to docs
7. Write tests

### Adding a New CLI Command

1. Add command to `src/cli/index.ts`
2. Use Commander's `.command()` API
3. Add options with `.option()`
4. Implement `.action()` handler
5. Add to README
6. Add to `docs/cli-reference.md`
7. Update shell completion

## Debugging Tips

1. **Configuration Issues**: Use `orc validate` to check config
2. **Dependency Problems**: Check dependency graph visualization
3. **Health Checks**: Enable verbose logging to see attempts
4. **Process Failures**: Check exit codes and signals
5. **Build Problems**: Run `pnpm build` and check for TypeScript errors
6. **tmux Issues**: Check tmux version and availability

## Resources

- [tmux manual](https://man.openbsd.org/tmux)
- [Kahn's algorithm](https://en.wikipedia.org/wiki/Topological_sorting#Kahn's_algorithm)
- [Zod documentation](https://zod.dev)
- [Commander.js](https://github.com/tj/commander.js)
- [Execa](https://github.com/sindresorhus/execa)

---

This document is maintained alongside the codebase. When making significant changes, update this file to reflect the new architecture or design decisions.
