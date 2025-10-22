# Troubleshooting

Common issues and solutions.

## Configuration Issues

### "Configuration validation failed"

**Problem**: Configuration file is invalid

**Solutions**:
1. Run `orc validate` to see specific errors
2. Check YAML syntax (use a YAML validator)
3. Verify all required fields are present
4. Check process types are valid

### "Circular dependency detected"

**Problem**: Processes have circular dependencies (A → B → A)

**Solution**: Review dependency graph with `orc validate` and break the cycle

### "Process 'X' depends on 'Y' which doesn't exist"

**Problem**: Referenced dependency doesn't exist

**Solution**: Fix the dependency name or add the missing process

## Startup Issues

### "tmux is not installed"

**Problem**: tmux is required but not found

**Solutions**:
- macOS: `brew install tmux`
- Ubuntu/Debian: `sudo apt-get install tmux`
- Fedora: `sudo dnf install tmux`

### "Docker daemon is not running"

**Problem**: Docker processes require Docker to be running

**Solutions**:
- Start Docker Desktop (macOS/Windows)
- Start Docker daemon: `sudo systemctl start docker` (Linux)
- Check Docker status: `docker info`

### "Required ports are already in use"

**Problem**: Ports needed by processes are occupied

**Solutions**:
1. Find process using port: `lsof -i :PORT`
2. Kill conflicting process
3. Change port in configuration

### Process fails to start

**Problem**: Process exits immediately or fails health check

**Solutions**:
1. Check process logs
2. Verify command is correct
3. Check working directory (`cwd`)
4. Verify environment variables
5. Test command manually
6. Increase health check timeout

## Health Check Issues

### Health check always times out

**Problem**: Process doesn't become ready within timeout

**Solutions**:
1. Increase timeout in ready check
2. Verify ready check configuration is correct
3. Check if process is actually starting
4. Test health check manually (curl, telnet, etc.)

### Log pattern never matches

**Problem**: Log pattern ready check doesn't find pattern

**Solutions**:
1. Check pattern is a valid regex
2. Verify process outputs the expected message
3. Check for typos in pattern
4. Test pattern with actual output

## Runtime Issues

### Process keeps restarting

**Problem**: Process fails and restarts repeatedly

**Solutions**:
1. Check process logs for errors
2. Review restart policy
3. Increase `restart_delay`
4. Fix underlying issue causing failures

### Build process shows wrong status

**Problem**: Webpack/Angular build status is incorrect

**Solutions**:
1. Enable deep integration: `integration: { mode: deep }`
2. Check build tool output format hasn't changed
3. Review output filtering configuration

## tmux Issues

### Can't attach to session

**Problem**: `orc attach` fails

**Solutions**:
1. Check tmux is installed
2. Verify session exists: `tmux ls`
3. Check session name matches

### Panes are not visible

**Problem**: tmux panes aren't showing content

**Solutions**:
1. Check process is actually running
2. Verify command output goes to stdout/stderr
3. Try attaching manually: `tmux attach -t orckit-dev`

## Performance Issues

### Slow startup

**Problem**: Takes too long to start all processes

**Solutions**:
1. Review dependency graph - too sequential?
2. Remove unnecessary dependencies
3. Reduce health check timeouts
4. Disable preflight checks if not needed

### High memory usage

**Problem**: tmux/processes use too much memory

**Solutions**:
1. Reduce `max_lines` in output configuration
2. Disable output buffering if not needed
3. Check for memory leaks in processes

## Debugging Tips

### Enable verbose logging

Add to your configuration:
```yaml
maestro:
  boot:
    style: timeline  # Most verbose
    show_hooks: true
    show_timing: true
```

### Test commands manually

Run process commands directly to verify they work:
```bash
cd /path/to/cwd
command-from-config
```

### Check process environment

Verify environment variables are set correctly:
```bash
env | grep VAR_NAME
```

### Validate configuration

Always validate before starting:
```bash
orc validate
```

### View dependency graph

Understanding startup order helps debug issues:
```bash
orc validate  # Shows dependency graph
```

## Getting Help

If you're still stuck:

1. Check the [documentation](README.md)
2. Search [GitHub Issues](https://github.com/orckit/cli/issues)
3. Create a new issue with:
   - Orckit version (`orc --version`)
   - Configuration file
   - Error messages
   - Steps to reproduce
