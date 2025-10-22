# Full-Stack SaaS Application Example

This example demonstrates a complete full-stack application architecture orchestrated by Orckit, showcasing:

- **Infrastructure**: PostgreSQL database and Redis cache (Docker containers)
- **Backend**: Node.js/Express API server with health checks
- **Workers**: Background job processing queue
- **Frontend**: Two Angular applications (Admin Dashboard and Customer Portal)
- **Tools**: API documentation with Swagger UI

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Full-Stack SaaS App                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Infrastructure Layer                                         │
│  ├─ PostgreSQL (port 5432)                                   │
│  └─ Redis (port 6379)                                        │
│                                                               │
│  Backend Layer                                                │
│  ├─ API Server (port 3000)                                   │
│  │  └─ Endpoints: /health, /api/users, /api/stats           │
│  └─ Worker Queue                                             │
│     └─ Background job processing                             │
│                                                               │
│  Frontend Layer                                               │
│  ├─ Admin Dashboard (port 4200)                              │
│  │  └─ User management and analytics                         │
│  └─ Customer Portal (port 4201)                              │
│     └─ Customer-facing features                              │
│                                                               │
│  Tools Layer                                                  │
│  └─ API Docs (port 8080)                                     │
│     └─ Swagger UI documentation                              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

Before running this example, ensure you have:

1. **Node.js** (v18 or higher)
   ```bash
   node --version
   ```

2. **Docker** (for PostgreSQL and Redis)
   ```bash
   docker --version
   ```

3. **pnpm** (package manager)
   ```bash
   npm install -g pnpm
   ```

4. **Orckit CLI** (built from source in parent directory)
   ```bash
   # From the project root
   pnpm build
   ```

## Quick Start

### Option 1: Automated Setup

Run the setup script to install all dependencies:

```bash
# From the fullstack-app directory
./setup.sh
```

### Option 2: Manual Setup

Install dependencies using pnpm workspaces:

```bash
# Install all workspace dependencies at once
pnpm install
```

### Start the Application

From the `fullstack-app` directory, run:

```bash
pnpm run orc start
# or simply:
pnpm start
```

Orckit will:
1. ✅ Run preflight checks (Docker, Node.js)
2. 🚀 Start infrastructure (PostgreSQL, Redis)
3. ⚙️  Start backend services (API, Worker)
4. 🎨 Start frontend applications (Admin, Customer Portal)
5. 📚 Start API documentation

## Access the Application

Once all services are running:

- **Admin Dashboard**: http://localhost:4200
- **Customer Portal**: http://localhost:4201
- **API Server**: http://localhost:3000
- **API Health Check**: http://localhost:3000/health
- **API Documentation**: http://localhost:8080

## Project Structure

```
fullstack-app/
├── orckit.yaml               # Orckit configuration
├── pnpm-workspace.yaml       # pnpm workspace configuration
├── package.json              # Root workspace package.json
├── README.md                 # This file
│
├── api/                      # Node.js API Server
│   ├── package.json
│   ├── server.js
│   └── swagger.yaml
│
├── worker/                   # Background Worker
│   ├── package.json
│   └── worker.js
│
├── admin-dashboard/          # Angular Admin App
│   ├── package.json
│   ├── angular.json
│   ├── tsconfig.json
│   └── src/
│       ├── main.ts
│       ├── index.html
│       └── app/
│           └── app.component.ts
│
└── customer-portal/          # Angular Customer App
    ├── package.json
    ├── angular.json
    ├── tsconfig.json
    └── src/
        ├── main.ts
        ├── index.html
        └── app/
            └── app.component.ts
```

## Orckit Features Demonstrated

### 1. **Dependency Management**
Services start in the correct order based on dependencies:
```yaml
processes:
  api-server:
    dependencies: [postgres, redis]

  admin-dashboard:
    dependencies: [api-server]
```

### 2. **Health Checks**
Orckit waits for services to be ready before starting dependent services:
```yaml
api-server:
  ready:
    type: http
    url: "http://localhost:3000/health"
    timeout: 60000
```

### 3. **Deep Integration**
Angular applications use deep integration mode for real-time build feedback:
```yaml
admin-dashboard:
  type: angular
  integration:
    mode: deep
```

### 4. **Process Categories**
Services are organized into tmux windows by category:
- **Infrastructure**: Database and cache
- **Backend**: API and workers
- **Frontend**: Angular applications
- **Tools**: Documentation and utilities

### 5. **Environment Variables**
Each service receives appropriate environment configuration:
```yaml
api-server:
  env:
    PORT: "3000"
    DATABASE_URL: "postgresql://postgres:dev@localhost:5432/myapp"
    REDIS_URL: "redis://localhost:6379"
```

### 6. **Preflight Checks**
Orckit validates system requirements before starting:
```yaml
preflight:
  checks:
    - name: "docker"
      command: "docker --version"
      error: "Docker is not installed"
```

## API Endpoints

The API server provides the following endpoints:

### Health Check
```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "services": {
    "database": "connected",
    "redis": "connected"
  }
}
```

### Get Users
```bash
curl http://localhost:3000/api/users
```

### Get Statistics
```bash
curl http://localhost:3000/api/stats
```

### Create User
```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "John Doe", "role": "user"}'
```

## Development Workflow

### Watch Mode
Both Angular applications run in watch mode by default, automatically rebuilding when files change.

### Hot Reload
Make changes to any Angular component and see them reflected in the browser immediately.

### Viewing Logs
Orckit organizes logs by category in separate tmux windows:
- Use `Ctrl-b w` to see all windows
- Navigate between windows with `Ctrl-b [number]`

### Stopping the Application
```bash
pnpm run orc stop
# or:
pnpm stop
```

Or press `Ctrl-C` in the Orckit terminal for graceful shutdown.

## Troubleshooting

### Port Already in Use
If you see "port already in use" errors:
```bash
# Check what's using the port
lsof -i :3000

# Kill the process
kill -9 [PID]
```

### Docker Containers Not Starting
Ensure Docker Desktop is running:
```bash
docker ps
```

### Angular Build Errors
Clear node_modules and reinstall:
```bash
# Clear all workspace node_modules
rm -rf node_modules api/node_modules worker/node_modules admin-dashboard/node_modules customer-portal/node_modules
pnpm install
```

### Database Connection Issues
Check PostgreSQL container is running:
```bash
docker ps | grep postgres
```

## Customization

### Changing Ports
Edit `orckit.yaml` to change service ports:
```yaml
api-server:
  env:
    PORT: "3001"  # Change API port
```

### Adding New Services
Add a new process to `orckit.yaml`:
```yaml
processes:
  my-service:
    category: backend
    type: node
    command: "npm start"
    cwd: "./my-service"
    dependencies: [postgres]
```

### Modifying Angular Apps
Angular applications use standalone components. Edit the component files:
- Admin Dashboard: `admin-dashboard/src/app/app.component.ts`
- Customer Portal: `customer-portal/src/app/app.component.ts`

## Production Deployment

This example is designed for **development only**. For production:

1. Build Angular applications:
   ```bash
   pnpm --filter admin-dashboard run build
   pnpm --filter customer-portal run build
   ```

2. Use production-grade PostgreSQL and Redis instances
3. Add authentication and authorization
4. Enable HTTPS/SSL
5. Add monitoring and logging
6. Configure environment variables properly
7. Use a process manager like PM2 or containerize with Docker

## Learn More

- [Orckit Documentation](https://github.com/your-org/orckit)
- [pnpm Workspaces](https://pnpm.io/workspaces)
- [Angular Documentation](https://angular.io)
- [Express.js Documentation](https://expressjs.com)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Redis Documentation](https://redis.io/docs/)

## License

This example is provided as-is for educational purposes.
