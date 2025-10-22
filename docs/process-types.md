# Process Types

Orckit supports multiple process types, each optimized for specific use cases.

## Bash (default)

Execute shell commands and scripts.

```yaml
processes:
  script:
    category: main
    type: bash  # or omit, bash is default
    command: "./scripts/start.sh"
```

## Docker

Run and manage Docker containers.

```yaml
processes:
  postgres:
    category: infrastructure
    type: docker
    command: "docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:15"
    ready:
      type: tcp
      host: localhost
      port: 5432
```

Features:
- Automatic container ID tracking
- Graceful shutdown (stop before kill)
- Automatic cleanup on exit

## Node.js

Run Node.js applications.

```yaml
processes:
  api:
    category: backend
    type: node
    command: "npm run dev"
    cwd: "./api"
    env:
      NODE_ENV: development
      PORT: "3000"
```

## TypeScript

Run TypeScript files directly with ts-node.

```yaml
processes:
  worker:
    category: backend
    type: ts-node
    command: "src/worker.ts"
    cwd: "./api"
```

## Webpack

Webpack builds with deep integration.

```yaml
processes:
  webpack:
    category: frontend
    type: webpack
    command: "npm run build:watch"
    integration:
      mode: deep  # Enable deep integration
    ready:
      type: log-pattern
      pattern: "Compiled successfully"
```

Deep integration provides:
- Real-time build progress
- Error and warning counts
- Bundle size tracking
- Build duration metrics

## Angular CLI

Angular builds with JSON output parsing.

```yaml
processes:
  angular:
    category: frontend
    type: angular
    command: "ng build --watch"
    integration:
      mode: deep
```

Deep integration provides:
- Structured build events
- Progress percentage
- Chunk information
- Build statistics

## Vite

Vite development server.

```yaml
processes:
  vite:
    category: frontend
    type: vite
    command: "npm run dev"
    ready:
      type: log-pattern
      pattern: "Local:"
```

## Build

Generic build processes.

```yaml
processes:
  custom_build:
    category: frontend
    type: build
    command: "npm run build:watch"
```

## Choosing a Process Type

- Use `bash` for simple scripts and commands
- Use `docker` for containerized services
- Use `node` or `ts-node` for Node.js/TypeScript applications
- Use `webpack`, `angular`, or `vite` for frontend builds with deep integration
- Use `build` for generic build processes
