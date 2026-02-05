# Runner Integration Tests

This directory contains comprehensive integration tests for each process runner type in Maestro/Orckit.

## Test Coverage

### ✅ BashRunner (All tests passing)
- **File:** `bash-runner.test.ts`
- **Tests:** 10/10 passing
- **Coverage:**
  - Basic command execution (echo, multi-line scripts)
  - Environment variable handling
  - Working directory support
  - Long-running processes
  - Error handling (stderr, non-zero exits)
  - Exit-code ready checks
  - Restart functionality

### ✅ WebpackRunner (All tests passing)
- **File:** `webpack-runner.test.ts`
- **Tests:** 6/6 passing
- **Coverage:**
  - Successful builds
  - Build event emission (start, progress, complete)
  - Build info tracking
  - Watch mode
  - Error handling
  - Restart functionality
- **Requirements:** Webpack example app with dependencies installed

### ⚠️ DockerRunner (Partial)
- **File:** `docker-runner.test.ts`
- **Tests:** 3/7 passing
- **Coverage:**
  - ✅ Long-running container lifecycle
  - ✅ Port mapping
  - ✅ Non-existent image error handling
  - ⚠️ Simple container output capture (timing issues)
  - ⚠️ Container ID capture
  - ⚠️ Environment variables
  - ⚠️ Container failure detection
- **Requirements:** Docker installed and running
- **Known Issues:**
  - Quick-exit containers may not have output captured in time
  - Event timing between container execution and test expectations

### ⚠️ AngularRunner (Partial)
- **File:** `angular-runner.test.ts`
- **Tests:** 3/8 passing
- **Coverage:**
  - ✅ Build info tracking
  - ✅ Error handling
  - ✅ Deep integration mode
  - ⚠️ Build success detection
  - ⚠️ Build event emission
  - ⚠️ Dev server
  - ⚠️ File change detection
  - ⚠️ Restart functionality
- **Requirements:** Angular app with dependencies installed
- **Known Issues:**
  - Angular builds may be failing due to missing dependencies
  - Long build times may cause timeouts
  - Dev server may not start successfully

## Running the Tests

```bash
# Run all runner integration tests
pnpm test tests/integration/runners

# Run specific runner tests
pnpm test tests/integration/runners/bash-runner.test.ts
pnpm test tests/integration/runners/webpack-runner.test.ts
pnpm test tests/integration/runners/docker-runner.test.ts
pnpm test tests/integration/runners/angular-runner.test.ts
```

## Prerequisites

1. **For all tests:**
   - Node.js installed
   - pnpm package manager

2. **For Docker tests:**
   - Docker installed and running
   - Ability to pull images (alpine, nginx)

3. **For Webpack tests:**
   - Dependencies installed: `cd examples/webpack-app && npm install`

4. **For Angular tests:**
   - Angular dependencies installed: `cd examples/fullstack-app/admin-dashboard && npm install`
   - May require Angular CLI: `npm install -g @angular/cli`

## Test Results Summary

| Runner | Tests | Status | Notes |
|--------|-------|--------|-------|
| **BashRunner** | 10/10 | ✅ All Pass | Fully working |
| **WebpackRunner** | 6/6 | ✅ All Pass | Fully working |
| **DockerRunner** | 3/7 | ⚠️ Partial | Output capture timing issues |
| **AngularRunner** | 3/8 | ⚠️ Partial | Build/serve failures |
| **TOTAL** | **22/31** | **71% Pass** | Good coverage, some issues |

## Next Steps

1. **Fix Docker output capture:**
   - Investigate why quick-exit containers don't produce captured output
   - May need to adjust timing or use different output capture strategy

2. **Fix Angular build issues:**
   - Verify Angular app dependencies are correctly installed
   - Check for Angular CLI version compatibility
   - Investigate why builds are failing

3. **Add more test scenarios:**
   - Health check integration (HTTP, TCP, log-pattern)
   - Hook execution
   - Process restart policies
   - Dependency chains

## Architecture Notes

These integration tests demonstrate the consolidated runner architecture where:
- **BaseRunner** provides full concrete implementation
- **Specialized runners** (Webpack, Angular, Docker) only override specific methods
- **BashRunner** is the simplest - just inherits with no overrides
- All runners share common lifecycle, event handling, and process management
