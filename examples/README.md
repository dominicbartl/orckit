# Orckit Examples

This directory contains example configurations and applications demonstrating various Orckit features and use cases.

## Available Examples

### 1. Minimal Example (`minimal.yaml`)
A simple, single-process example to get started with Orckit.

**Use case**: Learning the basics of Orckit configuration

**What it demonstrates**:
- Basic process configuration
- Simple command execution

**How to run**:
```bash
pnpm run orc start -c examples/minimal.yaml
```

---

### 2. Simple Example (`simple.yaml`)
A multi-service application with infrastructure, backend, and frontend layers.

**Use case**: Web application development with database and caching

**What it demonstrates**:
- Docker container orchestration (PostgreSQL, Redis)
- Process dependencies
- Health checks (TCP, HTTP, log patterns)
- Environment variables
- Output formatting and filtering
- Webpack integration
- Pre/post hooks
- Preflight checks

**Architecture**:
```
Infrastructure: PostgreSQL + Redis
Backend: Node.js API
Frontend: Webpack build + Dev server
```

**How to run**:
```bash
pnpm run orc start -c examples/simple.yaml
```

---

### 3. Full-Stack SaaS Application (`fullstack-app/`)
A comprehensive, production-like full-stack application with multiple services.

**Use case**: Complex SaaS application development with multiple frontends and background workers

**What it demonstrates**:
- Complete application architecture
- Multiple Angular frontends (Admin Dashboard + Customer Portal)
- Background worker queue
- API documentation with Swagger
- Real-time build feedback with Angular deep integration
- Database initialization
- Graceful shutdown handling
- Production-like service organization

**Architecture**:
```
Infrastructure: PostgreSQL + Redis (Docker)
Backend: Node.js API + Worker Queue
Frontend: 2x Angular Apps (ports 4200, 4201)
Tools: Swagger UI API Docs
```

**Services**:
- **Admin Dashboard** (http://localhost:4200) - User management and analytics
- **Customer Portal** (http://localhost:4201) - Customer-facing features
- **API Server** (http://localhost:3000) - REST API with health checks
- **Worker Queue** - Background job processing
- **API Docs** (http://localhost:8080) - Interactive API documentation

**How to run**:
```bash
cd examples/fullstack-app
./setup.sh              # Install dependencies with pnpm workspaces
pnpm run orc start      # Start all services
```

See [fullstack-app/README.md](fullstack-app/README.md) for detailed documentation.

---

## Choosing an Example

| Example | Complexity | Best For |
|---------|-----------|----------|
| `minimal.yaml` | Beginner | Learning Orckit basics |
| `simple.yaml` | Intermediate | Full-stack web apps with database |
| `fullstack-app/` | Advanced | Multi-service SaaS applications with pnpm workspaces |

## Common Features Across Examples

All examples demonstrate:
- ✅ Declarative YAML configuration
- ✅ Process lifecycle management
- ✅ Dependency resolution
- ✅ Output organization with tmux

Advanced examples add:
- ✅ Health checks and readiness detection
- ✅ Environment variable management
- ✅ Hot reload and watch mode
- ✅ Docker container orchestration
- ✅ Deep framework integration (Angular, Webpack)
- ✅ Graceful shutdown handling

## Running Examples

### Method 1: Direct Configuration File
```bash
pnpm run orc start -c examples/simple.yaml
```

### Method 2: From Example Directory
```bash
cd examples/fullstack-app
pnpm run orc start
# or simply:
pnpm start
```

### Method 3: Clone and Customize
```bash
# Copy an example to your project
cp examples/simple.yaml my-project/orckit.yaml

# Edit and customize
vim my-project/orckit.yaml

# Run it
cd my-project
orc start
```

## Creating Your Own Configuration

Start with an example that matches your use case:

1. **Single service**: Use `minimal.yaml`
2. **Web app with database**: Use `simple.yaml`
3. **Multi-service application with pnpm workspaces**: Use `fullstack-app/orckit.yaml`

Then customize:
- Add/remove processes
- Adjust dependencies
- Configure health checks
- Set environment variables
- Customize output formatting

## Documentation

For detailed information about Orckit configuration:
- [Orckit Documentation](../README.md)
- [Configuration Reference](../docs/configuration.md)
- [CLI Commands](../docs/cli.md)

## Contributing Examples

Have an interesting use case? Contribute an example:

1. Create a new directory in `examples/`
2. Add a `README.md` explaining the use case
3. Include a working `orckit.yaml`
4. Add any necessary application code
5. For complex examples, consider using pnpm workspaces
6. Update this README with your example

## Support

If you have questions or issues with any example:
- Check the example's README for troubleshooting
- Review Orckit documentation
- Open an issue on GitHub
