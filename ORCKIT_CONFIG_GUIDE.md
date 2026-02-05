# Orckit Configuration Guide for AI Agents

**Version:** 1.0
**Last Updated:** 2024-02-05
**Purpose:** Comprehensive guide for generating `orckit.yaml` configuration files

---

## Table of Contents

1. [Overview](#overview)
2. [Configuration Structure](#configuration-structure)
3. [Complete Configuration Reference](#complete-configuration-reference)
4. [Process Types](#process-types)
5. [Health Check Strategies](#health-check-strategies)
6. [Common Patterns](#common-patterns)
7. [Best Practices](#best-practices)
8. [Complete Examples](#complete-examples)

---

## Overview

**Orckit** (`@orckit/cli`) is a process orchestration tool for local development environments. It manages the lifecycle of multiple processes with:

- **Dependency Management**: Start processes in the correct order based on dependencies
- **Health Checks**: Wait for processes to be ready before starting dependents
- **Automatic Restarts**: Configure restart policies for failed processes
- **Output Management**: Filter and format process logs
- **Hooks**: Run commands before/after lifecycle events

**Key Use Cases:**
- Full-stack applications (frontend + backend + database)
- Microservices development
- Build tool orchestration (webpack, vite, etc.)
- Docker container management
- Database and infrastructure setup

---

## Configuration Structure

The `orckit.yaml` file has the following top-level structure:

```yaml
version: "1"                    # Configuration version (required)
project: "project-name"         # Project name (optional)
categories: {}                  # Process grouping for organization (optional)
processes: {}                   # Process definitions (required)
hooks: {}                       # Global lifecycle hooks (optional)
preflight: {}                   # Pre-start checks (optional)
maestro: {}                     # Boot/UI configuration (optional)
```

---

## Complete Configuration Reference

### 1. Root Configuration

```yaml
version: "1"
# REQUIRED. Configuration format version. Always use "1".

project: "my-project"
# OPTIONAL. Project name used for display and tmux session naming.
# Default: derived from directory name
```

### 2. Categories (Optional)

Categories group processes for organizational purposes:

```yaml
categories:
  infrastructure:
    window: "infra"
    # Groups infrastructure processes (databases, caches, etc.)

  backend:
    window: "backend"
    # Groups backend services (APIs, workers, etc.)

  frontend:
    window: "frontend"
    # Groups frontend processes (dev servers, build tools, etc.)
```

**Purpose**: Organize related processes together in the UI/output.

### 3. Processes (Required)

Each process has a unique name and configuration:

```yaml
processes:
  process-name:
    # ====================
    # REQUIRED FIELDS
    # ====================

    category: "backend"
    # REQUIRED. Category this process belongs to.

    command: "npm run dev"
    # REQUIRED. Shell command to execute.
    # Can be single-line or multi-line:
    # command: |
    #   echo "Starting..."
    #   npm run dev

    # ====================
    # OPTIONAL FIELDS
    # ====================

    type: "bash"
    # OPTIONAL. Process runner type.
    # Options: bash, docker, webpack, angular, node, ts-node, vite, build
    # Default: "bash"

    cwd: "./backend"
    # OPTIONAL. Working directory for the command.
    # Relative to config file location.
    # Default: config file directory

    dependencies: ["postgres", "redis"]
    # OPTIONAL. List of process names that must start first.
    # This process will wait for dependencies to be ready.
    # Default: []

    env:
      NODE_ENV: "development"
      PORT: "3000"
      DATABASE_URL: "postgresql://localhost:5432/db"
    # OPTIONAL. Environment variables for the process.
    # Default: {}

    restart: "on-failure"
    # OPTIONAL. Restart policy when process exits.
    # Options:
    #   - "always": Always restart (regardless of exit code)
    #   - "on-failure": Restart only on non-zero exit
    #   - "never": Never restart
    # Default: "on-failure"

    restart_delay: "5s"
    # OPTIONAL. Delay before restarting after failure.
    # Format: "5s", "2m", "1h"
    # Default: "5s"

    max_retries: 3
    # OPTIONAL. Maximum restart attempts before giving up.
    # Only applies when restart is "on-failure" or "always"
    # Default: 3

    # ====================
    # HEALTH CHECKS
    # ====================

    ready:
      # See "Health Check Strategies" section for details
      type: "http"
      url: "http://localhost:3000/health"
      timeout: 60000

    # ====================
    # OUTPUT CONFIGURATION
    # ====================

    output:
      format:
        timestamp: true
        # Add timestamps to each log line

        prefix: "API"
        # Add custom prefix to log lines

        max_lines: 1000
        # Maximum lines to buffer (default: 1000)

      filter:
        suppress_patterns:
          - ".*node_modules.*"
          - "webpack:.*"
        # Regex patterns to hide from output

        highlight_patterns:
          - pattern: "ERROR|Error"
            color: "red"
          - pattern: "WARN|Warning"
            color: "yellow"
          - pattern: "INFO"
            color: "blue"
        # Regex patterns to highlight in color

        include_patterns:
          - "Starting.*"
          - "Listening.*"
        # Whitelist mode: only show lines matching these patterns
        # If empty, all lines are shown (except suppressed)

    # ====================
    # LIFECYCLE HOOKS
    # ====================

    hooks:
      pre_start: "npm install"
      # Command to run before starting process

      post_start: "echo 'Process started'"
      # Command to run after process starts successfully

      pre_stop: "echo 'Stopping process'"
      # Command to run before stopping process

      post_stop: "echo 'Process stopped'"
      # Command to run after process stops

    # ====================
    # BUILD INTEGRATION
    # ====================

    integration:
      mode: "deep"
      # For build tools (webpack, angular, vite):
      # - "deep": Parse build events for progress/stats
      # - "logs-only": Just capture logs
      # Default: "logs-only"

    config: "./webpack.config.js"
    # OPTIONAL. Path to build tool config file.
    # Used by webpack, angular runners.

    preflight: ["check-node", "check-ports"]
    # OPTIONAL. Preflight checks to run before starting this process.
    # References checks defined in global preflight section.
    # Default: []
```

### 4. Global Hooks (Optional)

Run commands at global lifecycle events:

```yaml
hooks:
  pre_start_all: "echo 'Starting all processes...'"
  # Runs before starting any processes

  post_start_all: "echo 'All processes ready!'"
  # Runs after all processes are ready

  pre_stop_all: "echo 'Stopping all processes...'"
  # Runs before stopping processes

  post_stop_all: "echo 'All processes stopped'"
  # Runs after all processes stop
```

### 5. Preflight Checks (Optional)

Validate system state before starting processes:

```yaml
preflight:
  checks:
    - name: "node_version"
      command: "node --version | grep -q 'v18\\|v20'"
      error: "Node.js 18 or 20 required"
      fix: "Install Node.js: https://nodejs.org"
      # Check Node.js version

    - name: "docker_running"
      command: "docker info > /dev/null 2>&1"
      error: "Docker is not running"
      fix: "Start Docker Desktop"
      # Verify Docker daemon is running

    - name: "port_available"
      command: "! lsof -i :3000"
      error: "Port 3000 is already in use"
      fix: "Stop the process using port 3000"
      # Check if port is available

    - name: "dependencies_installed"
      command: "test -d ./node_modules"
      error: "Dependencies not installed"
      fix: "Run: npm install"
      # Verify dependencies are installed
```

**Preflight Check Fields:**
- `name`: Unique identifier for the check
- `command`: Shell command that should exit 0 for success
- `error`: Error message to show if check fails
- `fix`: (Optional) Instructions on how to fix the issue

### 6. Boot Configuration (Optional)

Customize the startup sequence display:

```yaml
maestro:
  boot:
    style: "timeline"
    # Boot display style:
    # - "timeline": Detailed timeline with progress
    # - "dashboard": Compact dashboard view
    # - "minimal": Minimal output
    # - "quiet": No boot output
    # Default: "timeline"

    show_preflight: true
    # Show preflight check results
    # Default: true

    show_graph: true
    # Show dependency graph
    # Default: true

    show_progress_bars: true
    # Show progress bars during startup
    # Default: true

    show_hooks: true
    # Show hook execution
    # Default: true

    show_timing: true
    # Show timing information
    # Default: true

    collapse_successful: false
    # Collapse successful processes in output
    # Default: false
```

---

## Process Types

### 1. `bash` (Default)

For general shell commands:

```yaml
my-process:
  category: backend
  type: bash
  command: "npm run dev"
```

**Use for:**
- Node.js applications (`npm run dev`, `node server.js`)
- Python applications (`python app.py`)
- Any shell command or script
- Most processes should use this type

### 2. `docker`

For Docker containers:

```yaml
postgres:
  category: infrastructure
  type: docker
  command: "docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:15"
  ready:
    type: tcp
    host: localhost
    port: 5432
```

**Use for:**
- Database containers (PostgreSQL, MySQL, MongoDB)
- Cache servers (Redis, Memcached)
- Message queues (RabbitMQ, Kafka)
- Any Docker container

### 3. `webpack`

For Webpack builds with deep integration:

```yaml
webpack:
  category: frontend
  type: webpack
  command: "npm run build:watch"
  cwd: "./web"
  config: "./web/webpack.config.js"
  integration:
    mode: deep  # Enables build progress/stats tracking
```

**Features:**
- Reports build progress percentage
- Captures errors and warnings
- Emits build events

### 4. `angular`

For Angular CLI with deep integration:

```yaml
angular:
  category: frontend
  type: angular
  command: "npm run start"  # or "ng serve"
  cwd: "./frontend"
  integration:
    mode: deep  # Enables build progress tracking
```

**Features:**
- Parses Angular CLI output
- Reports build progress
- Captures compilation errors

### 5. `node` / `ts-node`

For Node.js/TypeScript applications (legacy, use `bash` instead):

```yaml
api:
  category: backend
  type: node
  command: "node server.js"
  # OR
  type: ts-node
  command: "ts-node src/server.ts"
```

**Note:** These types are deprecated. Use `type: bash` with appropriate commands instead.

### 6. `vite`

For Vite dev server (legacy, use `bash` instead):

```yaml
vite-app:
  category: frontend
  type: vite
  command: "npm run dev"
```

**Note:** Use `type: bash` instead.

### 7. `build`

For one-time build commands:

```yaml
build-assets:
  category: build
  type: build
  command: "npm run build"
  ready:
    type: exit-code  # Wait for command to complete
```

**Use for:**
- Build steps that must complete before starting servers
- Asset compilation
- Database migrations
- Setup scripts

---

## Health Check Strategies

Health checks determine when a process is "ready" and its dependents can start.

### 1. HTTP Health Check

Wait for HTTP endpoint to return expected status:

```yaml
ready:
  type: http
  url: "http://localhost:3000/health"
  # URL to check

  expectedStatus: 200
  # Expected HTTP status code (default: 200)

  timeout: 60000
  # Total timeout in milliseconds (default: 60000)

  interval: 1000
  # Time between attempts in milliseconds (default: 1000)

  maxAttempts: 60
  # Maximum number of attempts (default: 60)
```

**Use for:**
- Web servers with health endpoints
- APIs
- Frontend dev servers

**Example:**
```yaml
api:
  category: backend
  command: "npm run dev"
  ready:
    type: http
    url: "http://localhost:3000/health"
    timeout: 60000
```

### 2. TCP Port Check

Wait for TCP port to accept connections:

```yaml
ready:
  type: tcp
  host: "localhost"
  # Host to check (default: localhost)

  port: 5432
  # Port number to check

  timeout: 60000
  # Total timeout in milliseconds (default: 60000)

  interval: 1000
  # Time between attempts in milliseconds (default: 1000)

  maxAttempts: 60
  # Maximum number of attempts (default: 60)
```

**Use for:**
- Databases (PostgreSQL, MySQL, MongoDB)
- Cache servers (Redis, Memcached)
- Message queues
- Any TCP service

**Example:**
```yaml
postgres:
  category: infrastructure
  command: "docker run --rm -p 5432:5432 postgres:15"
  ready:
    type: tcp
    host: localhost
    port: 5432
    timeout: 30000
```

### 3. Log Pattern Check

Wait for specific pattern in process output:

```yaml
ready:
  type: log-pattern
  pattern: "Server listening on port"
  # Regex pattern to match in stdout/stderr

  timeout: 120000
  # Total timeout in milliseconds (default: 60000)
```

**Use for:**
- Processes without HTTP/TCP endpoints
- Build tools (watch for "Compiled successfully")
- Custom startup messages

**Example:**
```yaml
webpack:
  category: frontend
  command: "npm run watch"
  ready:
    type: log-pattern
    pattern: "Compiled successfully|webpack.*compiled"
    timeout: 120000
```

### 4. Exit Code Check

Wait for process to exit successfully (exit code 0):

```yaml
ready:
  type: exit-code
  timeout: 60000
  # Total timeout in milliseconds (default: 60000)
```

**Use for:**
- Build scripts that must complete
- Database migrations
- Setup tasks
- One-time initialization

**Example:**
```yaml
migrate:
  category: backend
  command: "npm run migrate"
  ready:
    type: exit-code
    timeout: 30000
```

### 5. Custom Command Check

Run custom command to check readiness:

```yaml
ready:
  type: custom
  command: "curl -f http://localhost:3000/ready"
  # Command that should exit 0 when ready

  timeout: 60000
  # Total timeout in milliseconds (default: 60000)

  interval: 1000
  # Time between attempts in milliseconds (default: 1000)

  maxAttempts: 60
  # Maximum number of attempts (default: 60)
```

**Use for:**
- Complex health check logic
- Custom validation
- Multi-step checks

**Example:**
```yaml
custom-service:
  category: backend
  command: "./start-service.sh"
  ready:
    type: custom
    command: "./scripts/check-service-ready.sh"
    timeout: 30000
```

### No Health Check

If no `ready` field is specified, the process is considered ready immediately after starting:

```yaml
logger:
  category: tools
  command: "tail -f app.log"
  # No health check - ready immediately
```

---

## Common Patterns

### Pattern 1: Full-Stack Application

```yaml
version: "1"
project: "fullstack-app"

categories:
  infrastructure:
    window: "infra"
  backend:
    window: "backend"
  frontend:
    window: "frontend"

processes:
  # Layer 1: Infrastructure
  postgres:
    category: infrastructure
    type: docker
    command: "docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:15"
    ready:
      type: tcp
      host: localhost
      port: 5432
      timeout: 30000

  redis:
    category: infrastructure
    type: docker
    command: "docker run --rm -p 6379:6379 redis:7"
    ready:
      type: tcp
      host: localhost
      port: 6379
      timeout: 30000

  # Layer 2: Backend (depends on infrastructure)
  api:
    category: backend
    command: "npm run dev"
    cwd: "./api"
    dependencies: ["postgres", "redis"]
    env:
      DATABASE_URL: "postgresql://postgres:dev@localhost:5432/app"
      REDIS_URL: "redis://localhost:6379"
      PORT: "3000"
    ready:
      type: http
      url: "http://localhost:3000/health"
      timeout: 60000
    restart: on-failure

  # Layer 3: Frontend (depends on API)
  frontend:
    category: frontend
    command: "npm start"
    cwd: "./web"
    dependencies: ["api"]
    env:
      PORT: "4200"
      API_URL: "http://localhost:3000"
    ready:
      type: http
      url: "http://localhost:4200"
      timeout: 60000
    restart: on-failure
```

### Pattern 2: Microservices

```yaml
version: "1"
project: "microservices"

categories:
  infrastructure:
    window: "infra"
  services:
    window: "services"
  gateway:
    window: "gateway"

processes:
  # Infrastructure
  postgres:
    category: infrastructure
    type: docker
    command: "docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:15"
    ready:
      type: tcp
      host: localhost
      port: 5432

  rabbitmq:
    category: infrastructure
    type: docker
    command: "docker run --rm -p 5672:5672 -p 15672:15672 rabbitmq:3-management"
    ready:
      type: tcp
      host: localhost
      port: 5672

  # Services
  user-service:
    category: services
    command: "npm run dev"
    cwd: "./services/users"
    dependencies: ["postgres", "rabbitmq"]
    env:
      PORT: "3001"
    ready:
      type: http
      url: "http://localhost:3001/health"

  order-service:
    category: services
    command: "npm run dev"
    cwd: "./services/orders"
    dependencies: ["postgres", "rabbitmq"]
    env:
      PORT: "3002"
    ready:
      type: http
      url: "http://localhost:3002/health"

  # Gateway
  api-gateway:
    category: gateway
    command: "npm run dev"
    cwd: "./gateway"
    dependencies: ["user-service", "order-service"]
    env:
      PORT: "3000"
      USER_SERVICE_URL: "http://localhost:3001"
      ORDER_SERVICE_URL: "http://localhost:3002"
    ready:
      type: http
      url: "http://localhost:3000/health"
```

### Pattern 3: Build Pipeline

```yaml
version: "1"
project: "build-pipeline"

categories:
  build:
    window: "build"
  dev:
    window: "dev"

processes:
  # Step 1: Install dependencies
  install:
    category: build
    command: "npm install"
    ready:
      type: exit-code
      timeout: 120000

  # Step 2: Generate types
  generate:
    category: build
    command: "npm run generate:types"
    dependencies: ["install"]
    ready:
      type: exit-code

  # Step 3: Webpack in watch mode
  webpack:
    category: build
    type: webpack
    command: "npm run build:watch"
    dependencies: ["generate"]
    integration:
      mode: deep
    ready:
      type: log-pattern
      pattern: "Compiled successfully"

  # Step 4: Dev server
  dev-server:
    category: dev
    command: "npm run serve"
    dependencies: ["webpack"]
    ready:
      type: http
      url: "http://localhost:8080"
```

### Pattern 4: Database Migration + API

```yaml
version: "1"
project: "api-with-migrations"

processes:
  postgres:
    category: infrastructure
    type: docker
    command: "docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:15"
    ready:
      type: tcp
      host: localhost
      port: 5432

  migrate:
    category: backend
    command: "npm run migrate"
    cwd: "./api"
    dependencies: ["postgres"]
    env:
      DATABASE_URL: "postgresql://postgres:dev@localhost:5432/app"
    ready:
      type: exit-code
    restart: never  # Don't restart migrations

  api:
    category: backend
    command: "npm run dev"
    cwd: "./api"
    dependencies: ["migrate"]
    env:
      DATABASE_URL: "postgresql://postgres:dev@localhost:5432/app"
      PORT: "3000"
    ready:
      type: http
      url: "http://localhost:3000/health"
    restart: on-failure
```

### Pattern 5: Monorepo with Multiple Frontends

```yaml
version: "1"
project: "monorepo"

processes:
  # Shared API
  api:
    category: backend
    command: "npm run dev"
    cwd: "./packages/api"
    env:
      PORT: "3000"
    ready:
      type: http
      url: "http://localhost:3000/health"

  # Admin Dashboard
  admin-dashboard:
    category: frontend
    type: angular
    command: "npm run start"
    cwd: "./packages/admin"
    dependencies: ["api"]
    env:
      PORT: "4200"
    ready:
      type: http
      url: "http://localhost:4200"

  # Customer Portal
  customer-portal:
    category: frontend
    type: webpack
    command: "npm run dev"
    cwd: "./packages/customer"
    dependencies: ["api"]
    env:
      PORT: "4300"
    ready:
      type: http
      url: "http://localhost:4300"

  # Mobile API
  mobile-api:
    category: backend
    command: "npm run dev"
    cwd: "./packages/mobile-api"
    dependencies: ["api"]
    env:
      PORT: "3001"
    ready:
      type: http
      url: "http://localhost:3001/health"
```

---

## Best Practices

### 1. Process Naming

✅ **DO:**
- Use descriptive, lowercase names with hyphens: `user-service`, `api-gateway`
- Name by function/service: `postgres`, `redis`, `frontend`, `api`
- Keep names short but clear

❌ **DON'T:**
- Use spaces or special characters: `my api`, `service#1`
- Use generic names when you have multiple similar processes: `server1`, `server2`

### 2. Categories

✅ **DO:**
- Group by architectural layer: `infrastructure`, `backend`, `frontend`
- Use consistent category names across projects
- Keep category count reasonable (3-5 categories)

❌ **DON'T:**
- Create too many categories (makes UI cluttered)
- Mix unrelated processes in same category

### 3. Dependencies

✅ **DO:**
- Declare all true dependencies (process needs other to be ready)
- Use health checks to ensure dependencies are actually ready
- Keep dependency chains reasonable (3-4 levels max)

❌ **DON'T:**
- Create circular dependencies (A depends on B, B depends on A)
- Declare unnecessary dependencies (slows startup)

### 4. Health Checks

✅ **DO:**
- Always use health checks for services that have them
- Use `tcp` for databases and services without HTTP
- Use `http` for web servers and APIs
- Use `log-pattern` for build tools
- Set appropriate timeouts (databases may take 30s, APIs 60s)

❌ **DON'T:**
- Skip health checks for services with dependencies
- Use too short timeouts (process may not have time to start)
- Use `log-pattern` when HTTP/TCP is available (less reliable)

### 5. Environment Variables

✅ **DO:**
- Use environment variables for configuration
- Keep secrets out of the YAML (use `.env` files, reference in commands)
- Document what each variable does

❌ **DON'T:**
- Hardcode secrets in the YAML file
- Mix development and production config

### 6. Restart Policies

✅ **DO:**
- Use `on-failure` for most services (default)
- Use `always` for critical services that must stay up
- Use `never` for one-time tasks (migrations, builds)
- Set `max_retries` to prevent infinite restart loops

❌ **DON'T:**
- Use `always` for everything (may hide persistent errors)
- Set `max_retries` too high (delays problem detection)

### 7. Output Filtering

✅ **DO:**
- Suppress verbose/noisy output: `suppress_patterns`
- Highlight important messages: `highlight_patterns`
- Use colors consistently (red=error, yellow=warning, green=success)

❌ **DON'T:**
- Suppress error messages
- Over-filter (may hide important information)

### 8. Directory Structure

✅ **DO:**
- Place `orckit.yaml` at project root
- Use relative paths for `cwd`: `./api`, `./web`
- Keep process working directories organized

❌ **DON'T:**
- Use absolute paths (not portable)
- Navigate up beyond project root: `../../../other-project`

### 9. Hooks

✅ **DO:**
- Use `pre_start` for setup (npm install, dependency checks)
- Use `post_start` for notifications or logging
- Keep hooks fast (they block startup)

❌ **DON'T:**
- Put long-running tasks in hooks
- Rely on hooks for critical setup (use separate processes instead)

### 10. Documentation

✅ **DO:**
- Add comments explaining complex configuration
- Document non-obvious dependencies
- Include setup instructions in README

❌ **DON'T:**
- Leave configuration unexplained
- Assume everyone knows the architecture

---

## Complete Examples

### Example 1: Simple API + Frontend

```yaml
version: "1"
project: "simple-app"

categories:
  backend:
    window: "backend"
  frontend:
    window: "frontend"

processes:
  api:
    category: backend
    command: "npm run dev"
    cwd: "./api"
    env:
      PORT: "3000"
      NODE_ENV: "development"
    ready:
      type: http
      url: "http://localhost:3000/health"
      timeout: 60000
    restart: on-failure
    output:
      format:
        timestamp: true
        prefix: "API"
      filter:
        highlight_patterns:
          - pattern: "ERROR"
            color: "red"
          - pattern: "WARN"
            color: "yellow"

  frontend:
    category: frontend
    command: "npm start"
    cwd: "./web"
    dependencies: ["api"]
    env:
      PORT: "4200"
      API_URL: "http://localhost:3000"
    ready:
      type: http
      url: "http://localhost:4200"
      timeout: 60000
    restart: on-failure

hooks:
  post_start_all: "echo '✨ Application is ready at http://localhost:4200'"
```

### Example 2: Complex Full-Stack with Docker

```yaml
version: "1"
project: "complex-app"

categories:
  infrastructure:
    window: "infra"
  backend:
    window: "backend"
  frontend:
    window: "frontend"
  tools:
    window: "tools"

processes:
  # Infrastructure
  postgres:
    category: infrastructure
    type: docker
    command: "docker run --rm --name my-postgres -p 5432:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=myapp postgres:15-alpine"
    ready:
      type: tcp
      host: localhost
      port: 5432
      timeout: 30000
    restart: on-failure
    hooks:
      pre_start: "docker pull postgres:15-alpine"

  redis:
    category: infrastructure
    type: docker
    command: "docker run --rm --name my-redis -p 6379:6379 redis:7-alpine"
    ready:
      type: tcp
      host: localhost
      port: 6379
      timeout: 30000
    restart: on-failure

  # Backend
  migrate:
    category: backend
    command: "npm run migrate:latest"
    cwd: "./api"
    dependencies: ["postgres"]
    env:
      DATABASE_URL: "postgresql://postgres:dev@localhost:5432/myapp"
    ready:
      type: exit-code
      timeout: 30000
    restart: never

  seed:
    category: backend
    command: "npm run seed:dev"
    cwd: "./api"
    dependencies: ["migrate"]
    env:
      DATABASE_URL: "postgresql://postgres:dev@localhost:5432/myapp"
    ready:
      type: exit-code
      timeout: 30000
    restart: never

  api:
    category: backend
    command: "npm run dev"
    cwd: "./api"
    dependencies: ["seed", "redis"]
    env:
      NODE_ENV: "development"
      PORT: "3000"
      DATABASE_URL: "postgresql://postgres:dev@localhost:5432/myapp"
      REDIS_URL: "redis://localhost:6379"
      JWT_SECRET: "dev-secret-key"
      LOG_LEVEL: "debug"
    ready:
      type: http
      url: "http://localhost:3000/health"
      timeout: 60000
    restart: on-failure
    max_retries: 3
    hooks:
      pre_start: "cd ./api && npm install"
    output:
      format:
        timestamp: true
        prefix: "API"
      filter:
        suppress_patterns:
          - ".*node_modules.*"
        highlight_patterns:
          - pattern: "ERROR|Error"
            color: "red"
          - pattern: "WARN|Warning"
            color: "yellow"
          - pattern: "Starting|Listening"
            color: "green"

  worker:
    category: backend
    command: "npm run worker"
    cwd: "./api"
    dependencies: ["api"]
    env:
      NODE_ENV: "development"
      DATABASE_URL: "postgresql://postgres:dev@localhost:5432/myapp"
      REDIS_URL: "redis://localhost:6379"
    ready:
      type: log-pattern
      pattern: "Worker started|Ready to process jobs"
      timeout: 30000
    restart: always

  # Frontend
  webpack:
    category: frontend
    type: webpack
    command: "npm run build:watch"
    cwd: "./web"
    dependencies: ["api"]
    integration:
      mode: deep
    config: "./web/webpack.config.js"
    ready:
      type: log-pattern
      pattern: "Compiled successfully|webpack.*compiled"
      timeout: 120000
    restart: on-failure
    hooks:
      pre_start: "cd ./web && npm install"
    output:
      filter:
        suppress_patterns:
          - "asset.*"
          - "modules by path.*"
        highlight_patterns:
          - pattern: "Compiled successfully"
            color: "green"
          - pattern: "Failed to compile"
            color: "red"
          - pattern: "WARNING"
            color: "yellow"

  frontend:
    category: frontend
    command: "npm run serve"
    cwd: "./web"
    dependencies: ["webpack"]
    env:
      PORT: "4200"
      API_URL: "http://localhost:3000"
    ready:
      type: http
      url: "http://localhost:4200"
      timeout: 60000
    restart: on-failure

  # Tools
  maildev:
    category: tools
    type: docker
    command: "docker run --rm -p 1080:1080 -p 1025:1025 maildev/maildev"
    ready:
      type: http
      url: "http://localhost:1080"
      timeout: 30000
    restart: on-failure

  docs:
    category: tools
    command: "npm run docs:serve"
    cwd: "./docs"
    dependencies: ["api"]
    ready:
      type: http
      url: "http://localhost:8080"
      timeout: 30000

hooks:
  pre_start_all: |
    echo "🚀 Starting development environment..."
    echo "Checking prerequisites..."
  post_start_all: |
    echo "✨ All services are ready!"
    echo ""
    echo "📱 Application: http://localhost:4200"
    echo "🔧 API: http://localhost:3000"
    echo "📧 Maildev: http://localhost:1080"
    echo "📚 Docs: http://localhost:8080"
    echo ""
    echo "Run 'orc status' to check process status"

preflight:
  checks:
    - name: "node_version"
      command: "node --version | grep -E 'v(18|20)'"
      error: "Node.js 18 or 20 required"
      fix: "Install Node.js from https://nodejs.org"

    - name: "docker_running"
      command: "docker info > /dev/null 2>&1"
      error: "Docker is not running"
      fix: "Start Docker Desktop"

    - name: "ports_available"
      command: "! lsof -i :3000 && ! lsof -i :4200 && ! lsof -i :5432"
      error: "Required ports are already in use"
      fix: "Stop processes using ports 3000, 4200, 5432"

maestro:
  boot:
    style: timeline
    show_preflight: true
    show_graph: true
    show_progress_bars: true
    show_timing: true
```

### Example 3: Monorepo with Multiple Services

```yaml
version: "1"
project: "monorepo-services"

categories:
  infrastructure:
    window: "infra"
  services:
    window: "services"
  gateway:
    window: "gateway"
  frontend:
    window: "frontend"

processes:
  # Infrastructure
  postgres:
    category: infrastructure
    type: docker
    command: "docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:15"
    ready:
      type: tcp
      host: localhost
      port: 5432

  redis:
    category: infrastructure
    type: docker
    command: "docker run --rm -p 6379:6379 redis:7"
    ready:
      type: tcp
      host: localhost
      port: 6379

  rabbitmq:
    category: infrastructure
    type: docker
    command: "docker run --rm -p 5672:5672 -p 15672:15672 rabbitmq:3-management"
    ready:
      type: tcp
      host: localhost
      port: 5672

  # Microservices
  auth-service:
    category: services
    command: "npm run dev"
    cwd: "./services/auth"
    dependencies: ["postgres", "redis"]
    env:
      PORT: "3001"
      DATABASE_URL: "postgresql://postgres:dev@localhost:5432/auth"
      REDIS_URL: "redis://localhost:6379"
    ready:
      type: http
      url: "http://localhost:3001/health"

  user-service:
    category: services
    command: "npm run dev"
    cwd: "./services/users"
    dependencies: ["postgres", "rabbitmq"]
    env:
      PORT: "3002"
      DATABASE_URL: "postgresql://postgres:dev@localhost:5432/users"
      RABBITMQ_URL: "amqp://localhost:5672"
    ready:
      type: http
      url: "http://localhost:3002/health"

  order-service:
    category: services
    command: "npm run dev"
    cwd: "./services/orders"
    dependencies: ["postgres", "rabbitmq"]
    env:
      PORT: "3003"
      DATABASE_URL: "postgresql://postgres:dev@localhost:5432/orders"
      RABBITMQ_URL: "amqp://localhost:5672"
    ready:
      type: http
      url: "http://localhost:3003/health"

  notification-service:
    category: services
    command: "npm run dev"
    cwd: "./services/notifications"
    dependencies: ["rabbitmq"]
    env:
      PORT: "3004"
      RABBITMQ_URL: "amqp://localhost:5672"
    ready:
      type: http
      url: "http://localhost:3004/health"

  # API Gateway
  api-gateway:
    category: gateway
    command: "npm run dev"
    cwd: "./gateway"
    dependencies: ["auth-service", "user-service", "order-service"]
    env:
      PORT: "3000"
      AUTH_SERVICE_URL: "http://localhost:3001"
      USER_SERVICE_URL: "http://localhost:3002"
      ORDER_SERVICE_URL: "http://localhost:3003"
    ready:
      type: http
      url: "http://localhost:3000/health"

  # Frontend
  admin-dashboard:
    category: frontend
    type: angular
    command: "npm start"
    cwd: "./apps/admin"
    dependencies: ["api-gateway"]
    env:
      PORT: "4200"
      API_URL: "http://localhost:3000"
    ready:
      type: http
      url: "http://localhost:4200"

  customer-portal:
    category: frontend
    type: webpack
    command: "npm run dev"
    cwd: "./apps/customer"
    dependencies: ["api-gateway"]
    env:
      PORT: "4300"
      API_URL: "http://localhost:3000"
    ready:
      type: http
      url: "http://localhost:4300"
```

---

## Instructions for AI Agents

When generating an `orckit.yaml` file for a project:

### 1. Analyze the Project Structure

**Check for:**
- Package managers (package.json, requirements.txt, Gemfile, etc.)
- Docker configurations (Dockerfile, docker-compose.yml)
- Build tools (webpack.config.js, angular.json, vite.config.js)
- Multiple services/microservices
- Database dependencies
- Environment files (.env.example, .env.sample)

### 2. Identify Process Types

**For each process, determine:**
- **Type**: Is it a database, API, frontend, build tool, or script?
- **Command**: How is it normally started? (npm run dev, docker run, etc.)
- **Dependencies**: What must be running before this can start?
- **Working Directory**: Where should the command run?
- **Health Check**: How do we know when it's ready?

### 3. Determine Dependencies

**Create a dependency graph:**
1. Infrastructure layer (databases, caches, message queues)
2. Backend services (APIs, workers)
3. Build tools (webpack, typescript compiler)
4. Frontend applications (dev servers)

### 4. Choose Health Checks

**Selection guide:**
- Databases → `tcp` (check port)
- HTTP APIs → `http` (check /health endpoint)
- Build tools → `log-pattern` (watch for "compiled successfully")
- One-time tasks → `exit-code` (wait for completion)
- Other → `custom` (run a check command)

### 5. Set Appropriate Timeouts

**Guidelines:**
- Databases: 30s
- APIs: 60s
- Build tools: 120s
- Complex startup: 180s

### 6. Add Useful Output Filtering

**Suppress:**
- Node modules paths
- Verbose webpack output
- Debug logs (if too noisy)

**Highlight:**
- ERROR/Error → red
- WARN/Warning → yellow
- Success messages → green

### 7. Include Preflight Checks

**Common checks:**
- Node.js version
- Docker running (if using containers)
- Port availability
- Dependencies installed (node_modules exists)

### 8. Add Helpful Hooks

**Suggestions:**
- `pre_start`: npm install (if needed)
- `post_start_all`: Display URLs and helpful info

### 9. Validate Configuration

**Check that:**
- All dependencies exist
- No circular dependencies
- Port numbers don't conflict
- Paths are relative and valid
- Commands are correct

### 10. Add Comments

**Document:**
- Purpose of each process
- Why dependencies exist
- Non-obvious configuration choices

---

## Common Pitfalls to Avoid

1. **Circular Dependencies**: A depends on B, B depends on A
2. **Missing Health Checks**: Dependents start before dependencies are ready
3. **Wrong Process Types**: Using specific types when `bash` would work
4. **Absolute Paths**: Configuration won't be portable
5. **Missing Port Numbers**: Forgetting to configure unique ports
6. **Too Short Timeouts**: Process doesn't have time to start
7. **Over-Filtering Output**: Hiding important errors
8. **Hardcoded Secrets**: Putting passwords in YAML
9. **No Categories**: All processes in one category (hard to navigate)
10. **Complex Dependencies**: More than 4 layers of dependencies

---

## Validation Checklist

Before finalizing the configuration:

- [ ] All process names are unique and descriptive
- [ ] Categories are logical and consistent
- [ ] Dependencies form a valid DAG (no cycles)
- [ ] All referenced dependencies exist
- [ ] Health checks are appropriate for each process type
- [ ] Timeouts are reasonable (not too short/long)
- [ ] Port numbers don't conflict
- [ ] Environment variables are documented
- [ ] Working directories exist
- [ ] Commands are valid for the project
- [ ] Restart policies are appropriate
- [ ] Output filtering helps (doesn't hide errors)
- [ ] Preflight checks cover important requirements
- [ ] Hooks are fast (not long-running tasks)
- [ ] Comments explain non-obvious choices

---

## Version History

- **1.0** (2024-02-05): Initial comprehensive guide

---

## Support

For issues or questions:
- Documentation: See project README
- GitHub: https://github.com/dominicbartl/orckit
- Examples: See `examples/` directory in project

---

**End of Guide**
