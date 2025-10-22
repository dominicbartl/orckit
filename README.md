# Orckit

> Process orchestration tool for local development environments with tmux integration

[![npm version](https://img.shields.io/npm/v/@orckit/cli.svg)](https://www.npmjs.com/package/@orckit/cli)
[![CI](https://github.com/dominicbartl/orkkit/workflows/CI/badge.svg)](https://github.com/dominicbartl/orkkit/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/dominicbartl/orkkit/branch/main/graph/badge.svg)](https://codecov.io/gh/dominicbartl/orkkit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/@orckit/cli)](https://nodejs.org)

Orckit is a powerful CLI tool for managing complex local development environments. It orchestrates multiple processes with dependency management, health checks, and beautiful tmux-based monitoring.

## Features

- **Dependency Management**: Define startup order with automatic dependency resolution
- **Health Checks**: HTTP, TCP, log pattern, and custom ready checks
- **tmux Integration**: Beautiful themed tmux sessions with process categorization
- **Output Filtering**: Suppress noise and highlight important log patterns
- **Pre/Post Hooks**: Run commands before and after process lifecycle events
- **Deep Build Integration**: Direct integration with Webpack, Angular CLI, and Vite
- **Programmatic API**: Control processes from TypeScript/JavaScript
- **Auto-Restart**: Configurable restart policies for failed processes
- **Preflight Checks**: Validate environment before starting processes
- **Creative Boot Logging**: Multiple boot visualization styles

## Installation

```bash
# Using pnpm
pnpm add -g @orckit/cli

# Using npm
npm install -g @orckit/cli

# Using yarn
yarn global add @orckit/cli
```

## Quick Start

1. Create an `orckit.yaml` configuration file:

```yaml
version: "1"
project: "my-app"

processes:
  api:
    category: backend
    command: "npm run dev"
    cwd: "./api"
    ready:
      type: http
      url: "http://localhost:3000/health"

  frontend:
    category: frontend
    command: "npm start"
    cwd: "./web"
    dependencies: [api]
    ready:
      type: log-pattern
      pattern: "Compiled successfully"
```

2. Start your processes:

```bash
orc start
```

3. View status:

```bash
orc status
orc list
```

## CLI Commands

### `orc start [processes...]`

Start all processes or specific processes.

```bash
orc start                    # Start all processes
orc start api frontend       # Start specific processes
orc start -c config.yaml     # Use custom config file
```

### `orc stop [processes...]`

Stop running processes.

```bash
orc stop                     # Stop all processes
orc stop api                 # Stop specific process
```

### `orc restart <processes...>`

Restart one or more processes.

```bash
orc restart api
orc restart api frontend
```

### `orc status`

Show status of all processes.

```bash
orc status
```

### `orc list`

List all defined processes with their configuration.

```bash
orc list
```

### `orc validate`

Validate configuration file and show dependency graph.

```bash
orc validate
orc validate -c config.yaml
```

### `orc logs <process>`

View logs for a specific process.

```bash
orc logs api
orc logs api --follow        # Follow log output
```

### `orc attach <process>`

Attach to a process's tmux pane.

```bash
orc attach api
```

## Configuration

See [docs/configuration.md](docs/configuration.md) for complete configuration reference.

### Process Types

- `bash` - Shell commands and scripts
- `docker` - Docker containers
- `node` - Node.js applications
- `ts-node` - TypeScript applications
- `webpack` - Webpack builds with deep integration
- `angular` - Angular CLI with deep integration
- `vite` - Vite dev server
- `build` - Generic build processes

### Ready Checks

- **HTTP**: Wait for HTTP endpoint to return expected status
- **TCP**: Wait for TCP port to be available
- **Exit Code**: Wait for command to exit with code 0
- **Log Pattern**: Wait for specific pattern in logs
- **Custom**: Run custom command to check readiness

### Example Configuration

```yaml
version: "1"
project: "full-stack-app"

categories:
  infrastructure:
    window: "infra"
  backend:
    window: "backend"
  frontend:
    window: "frontend"

processes:
  postgres:
    category: infrastructure
    type: docker
    command: "docker run --rm -p 5432:5432 postgres:15"
    ready:
      type: tcp
      host: localhost
      port: 5432

  api:
    category: backend
    command: "npm run dev"
    dependencies: [postgres]
    env:
      DATABASE_URL: "postgresql://localhost:5432/myapp"
    ready:
      type: http
      url: "http://localhost:3000/health"
    hooks:
      pre_start: "npm install"
    output:
      filter:
        highlight_patterns:
          - pattern: "ERROR"
            color: "red"
    restart: on-failure
    max_retries: 3

  webpack:
    category: frontend
    type: webpack
    command: "npm run build:watch"
    dependencies: [api]
    integration:
      mode: deep
```

## Programmatic API

Use Orckit from TypeScript/JavaScript:

```typescript
import { Orckit } from '@orckit/cli';

const orckit = new Orckit({
  configPath: './orckit.yaml'
});

// Listen to events
orckit.on('process:starting', (event) => {
  console.log(`Starting ${event.processName}...`);
});

orckit.on('process:ready', (event) => {
  console.log(`${event.processName} is ready!`);
});

orckit.on('build:progress', (event) => {
  console.log(`Building ${event.processName}: ${event.progress}%`);
});

// Start processes
await orckit.start();

// Control processes
await orckit.stop(['api']);
await orckit.restart(['frontend']);

// Query status
const status = orckit.getStatus('api');
const allStatuses = orckit.getStatus();

// Wait for process
const isReady = await orckit.waitForReady('api', { timeout: 30000 });

// Dynamic management
orckit.addProcess('worker', {
  category: 'backend',
  command: 'node worker.js',
});
```

## Build Tool Plugins

### Webpack Plugin

```javascript
// webpack.config.js
import { MaestroWebpackPlugin } from '@orckit/cli/webpack';

export default {
  plugins: [
    new MaestroWebpackPlugin({
      maestroConfig: './orckit.yaml',
      processName: 'webpack',
      waitFor: ['api']
    })
  ]
};
```

### Vite Plugin

```typescript
// vite.config.ts
import { maestro } from '@orckit/cli/vite';

export default defineConfig({
  plugins: [
    maestro({
      configPath: './orckit.yaml',
      processName: 'vite',
      startDependencies: true
    })
  ]
});
```

## Documentation

- [Getting Started](docs/getting-started.md)
- [Configuration Reference](docs/configuration.md)
- [Process Types](docs/process-types.md)
- [Health Checks](docs/health-checks.md)
- [Hooks](docs/hooks.md)
- [Output Filtering](docs/output-filtering.md)
- [tmux Integration](docs/tmux-integration.md)
- [CLI Reference](docs/cli-reference.md)
- [Programmatic API](docs/programmatic-api.md)
- [Build Integration](docs/build-integration.md)
- [Troubleshooting](docs/troubleshooting.md)

## Examples

See the [examples/](examples/) directory for complete examples:

- [simple.yaml](examples/simple.yaml) - Full-stack application
- [minimal.yaml](examples/minimal.yaml) - Minimal setup

## Development

```bash
# Clone repository
git clone https://github.com/orckit/cli.git
cd cli

# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Watch mode
pnpm dev
```

## Requirements

- Node.js >= 18.0.0
- tmux (for session management)
- Docker (if using Docker processes)

## License

MIT © Dominic Bartl

## Contributing

Contributions are welcome! Please read our [contributing guidelines](CONTRIBUTING.md) first.

## Support

- [GitHub Issues](https://github.com/orckit/cli/issues)
- [Documentation](docs/)

---

Made with ❤️ for developers who juggle multiple services
