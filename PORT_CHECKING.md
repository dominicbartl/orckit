# Port Checking and Conflict Detection

Orckit includes comprehensive port checking to detect and report port conflicts with detailed information about what process is using each port.

## Features

### 1. **Automatic Port Detection**
Orckit automatically extracts port numbers from your configuration:
- Process commands (e.g., `ng serve --port 4200`)
- Environment variables (e.g., `PORT: "3000"`)
- Ready check URLs (e.g., `http://localhost:3000/health`)
- TCP check configurations

### 2. **Detailed Conflict Information**
When a port conflict is detected, Orckit shows:
- **Port number**
- **Process name** (e.g., node, docker, nginx)
- **Process ID (PID)**
- **Command line** that started the process
- **User** running the process
- **How to fix** the conflict

### 3. **Multiple Check Points**
Port checking happens at three stages:

#### Preflight Checks (Before Starting)
```bash
orc start
```

Output when port is in use:
```
❌ port_availability
   Port conflicts detected:

   Port 3000 is already in use
     Process: node (PID: 12345)
     Command: node server.js
     User: dominic

   To free this port, you can:
     1. Stop the process: kill 12345
     2. Use a different port in your configuration
     3. Check if this is a leftover process from a previous run
```

#### Health Checks (During Startup)
When waiting for a process to be ready:
```
⚙  Starting api-server...
   Waiting for http://localhost:3000/health...

   ❌ Health check failed:
   Port 3000 is already in use
     Process: node (PID: 12345)
     Command: npm run dev
     User: dominic
```

#### Runtime Detection
If a process fails to bind to a port:
```
❌ api-server failed to start
   Error: Port 3000 is already in use
     Process: node (PID: 12345)
```

## Usage Examples

### Check Configuration Before Starting

```bash
# Validate config and check ports
orc validate -c orckit.yaml

# With debug logging
orc validate -c orckit.yaml --debug
```

### Start with Port Checking

```bash
# Orckit automatically checks ports during preflight
orc start

# With debug to see detailed port checking
orc start --debug
```

### Common Port Conflict Messages

#### Port in Use by Known Process
```
Port 3000 is already in use
  Process: node (PID: 45231)
  Command: node dist/server.js
  User: dominic

To free this port, you can:
  1. Stop the process: kill 45231
  2. Use a different port in your configuration
  3. Check if this is a leftover process from a previous run
```

#### Port in Use by Docker Container
```
Port 5432 is already in use
  Process: com.docker.backend (PID: 98765)
  Command: /Applications/Docker.app/Contents/MacOS/com.docker.backend
  User: dominic

To free this port, you can:
  1. Stop the Docker container using this port
  2. Use: docker ps to see running containers
  3. Stop with: docker stop <container-id>
```

#### Multiple Port Conflicts
```
Port conflicts detected:

Port 3000 is already in use
  Process: node (PID: 12345)
  Command: npm run dev
  User: dominic

---

Port 4200 is already in use
  Process: node (PID: 12346)
  Command: ng serve
  User: dominic

---

Port 5432 is already in use
  Process: postgres (PID: 567)
  Command: /usr/local/bin/postgres
  User: postgres
```

## Supported Platforms

- ✅ **macOS** - Full support with `lsof` and `ps`
- ✅ **Linux** - Full support with `lsof` and `ps`
- ⚠️  **Windows** - Basic support (port detection only, no process details)

## Configuration

### Automatic Detection
Ports are automatically extracted from:

```yaml
processes:
  api:
    command: "npm run dev"
    env:
      PORT: "3000"  # ← Detected
    ready:
      type: http
      url: "http://localhost:3000/health"  # ← Port detected

  postgres:
    command: "docker run -p 5432:5432 postgres"  # ← 5432 detected
    ready:
      type: tcp
      port: 5432  # ← Also detected here
```

### Manual Port Specification
You can also add explicit port checks in preflight:

```yaml
preflight:
  checks:
    - name: custom_port_check
      command: "lsof -i :8080"
      error: "Port 8080 is already in use"
      fix: "Stop the process using port 8080"
```

## Troubleshooting

### Finding What's Using a Port Manually

```bash
# macOS/Linux
lsof -i :3000

# Alternative with netstat
netstat -anv | grep 3000

# Get process details
ps -p <PID> -o comm=,command=,user=
```

### Common Port Conflicts

#### Node.js Dev Server Still Running
```bash
# Find all node processes
ps aux | grep node

# Kill specific process
kill <PID>

# Or kill all node processes (careful!)
killall node
```

#### Docker Container Using Port
```bash
# List running containers
docker ps

# Stop container
docker stop <container-id>

# Remove container
docker rm <container-id>
```

#### Previous Orckit Session
Sometimes processes from a previous Orckit session might still be running:

```bash
# Find tmux sessions
tmux ls

# Kill old Orckit session
tmux kill-session -t orckit

# Or kill all tmux sessions
tmux kill-server
```

### Port Already in Use - Normal Cases

Some port conflicts are intentional:
- Database already running (e.g., PostgreSQL on 5432)
- Redis server running (e.g., on 6379)
- Development server from another project

In these cases, you can:
1. Stop the other service
2. Change your port in the configuration
3. Use the existing service (if compatible)

## Debug Mode

Enable debug mode to see detailed port checking:

```bash
orc start --debug --log-level DEBUG
```

You'll see:
```
[10:30:45.123] [DEBUG] [PortUtils] Checking port availability { port: 3000 }
[10:30:45.125] [DEBUG] [PortUtils] Port is in use { port: 3000 }
[10:30:45.126] [DEBUG] [PortUtils] Getting port user info { port: 3000 }
[10:30:45.150] [INFO] [PortUtils] Found process using port {
  "port": 3000,
  "pid": 12345,
  "processName": "node",
  "user": "dominic"
}
[10:30:45.152] [WARN] [PreflightChecks] Port conflicts detected {
  "count": 1,
  "ports": [3000]
}
```

## Programmatic Usage

If you're extending Orckit or building on top of it:

```typescript
import {
  checkPort,
  checkPorts,
  getPortUser,
  formatPortConflictMessage,
  extractPorts,
} from '@orckit/cli/utils/port.js';

// Check a single port
const result = await checkPort(3000);
if (!result.available && result.user) {
  console.log(formatPortConflictMessage(3000, result.user));
}

// Check multiple ports
const conflicts = await checkPorts([3000, 4200, 5432]);

// Extract ports from configuration text
const ports = extractPorts('docker run -p 5432:5432 postgres');
// Returns: [5432]

// Get details about what's using a port
const user = await getPortUser(3000);
if (user) {
  console.log(`PID: ${user.pid}`);
  console.log(`Process: ${user.processName}`);
  console.log(`Command: ${user.command}`);
}
```

## Best Practices

1. **Run `orc validate` First**
   ```bash
   orc validate -c orckit.yaml
   ```
   This checks ports without starting anything.

2. **Use Unique Ports for Development**
   Avoid common ports like 8080, 8000, 3000 if possible.

3. **Check for Leftover Processes**
   Before starting Orckit, check for leftover processes:
   ```bash
   tmux ls
   ps aux | grep node
   ```

4. **Clean Stop**
   Always stop Orckit cleanly:
   ```bash
   orc stop
   # or press Ctrl+C in the tmux session
   ```

5. **Use Docker Compose Names**
   For Docker containers, use unique container names to easily identify them.

## Testing

You can test the port checking with the included test script:

```bash
# Run the test
node test-port-check.js

# The script will:
# 1. Start a server on port 3000
# 2. Run port checking
# 3. Show detailed process information
# 4. Clean up
```

## Future Enhancements

Planned improvements:
- Windows support with `netstat` integration
- Port suggestion when conflicts detected
- Interactive mode to kill conflicting processes
- Integration with Docker to automatically start containers on different ports
- Cloud-based port allocation for team environments
