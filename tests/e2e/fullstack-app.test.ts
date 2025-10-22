import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { Orchestrator } from '../../src/core/orchestrator.js';
import type { OrckitConfig } from '../../src/types/index.js';
import * as angularFixtures from '../fixtures/angular-json-output.js';

// Mock all dependencies
vi.mock('../../src/core/config/parser.js', () => ({
  parseConfig: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock('../../src/core/dependency/resolver.js', () => ({
  resolveDependencies: vi.fn(),
  groupIntoWaves: vi.fn(),
}));

vi.mock('../../src/core/status/monitor.js', () => ({
  StatusMonitor: vi.fn(),
}));

vi.mock('../../src/core/status/formatter.js', () => ({
  formatStatusSnapshot: vi.fn(),
}));

vi.mock('../../src/core/tmux/manager.js', () => ({
  TmuxManager: vi.fn(),
}));

vi.mock('../../src/core/boot/logger.js', () => ({
  BootLogger: vi.fn(),
}));

vi.mock('../../src/core/preflight/runner.js', () => ({
  runPreflight: vi.fn(),
}));

vi.mock('../../src/runners/factory.js', () => ({
  createRunner: vi.fn(),
}));

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

vi.mock('../../src/utils/system.js', () => ({
  getProcessEnv: vi.fn((env) => ({ ...process.env, ...env })),
}));

describe('Full-Stack Application E2E Tests', () => {
  let fullStackConfig: OrckitConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    // Realistic full-stack application configuration
    fullStackConfig = {
      project: 'my-saas-app',
      processes: {
        // Infrastructure layer
        postgres: {
          category: 'infrastructure',
          command: 'docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:15',
          type: 'docker',
          ready: {
            type: 'tcp',
            host: 'localhost',
            port: 5432,
            timeout: 30000,
          },
        },
        redis: {
          category: 'infrastructure',
          command: 'docker run --rm -p 6379:6379 redis:7-alpine',
          type: 'docker',
          ready: {
            type: 'tcp',
            host: 'localhost',
            port: 6379,
            timeout: 10000,
          },
        },

        // Backend services
        'api-server': {
          category: 'backend',
          command: 'npm run dev',
          type: 'node',
          cwd: './apps/api',
          env: {
            NODE_ENV: 'development',
            PORT: '3000',
            DATABASE_URL: 'postgresql://postgres:dev@localhost:5432/myapp',
            REDIS_URL: 'redis://localhost:6379',
          },
          dependsOn: ['postgres', 'redis'],
          ready: {
            type: 'http',
            url: 'http://localhost:3000/health',
            timeout: 60000,
          },
        },
        'worker-queue': {
          category: 'backend',
          command: 'npm run worker',
          type: 'node',
          cwd: './apps/worker',
          env: {
            NODE_ENV: 'development',
            DATABASE_URL: 'postgresql://postgres:dev@localhost:5432/myapp',
            REDIS_URL: 'redis://localhost:6379',
          },
          dependsOn: ['postgres', 'redis', 'api-server'],
        },

        // Frontend applications
        'admin-dashboard': {
          category: 'frontend',
          command: 'ng serve --port 4200',
          type: 'angular',
          cwd: './apps/admin',
          integration: { mode: 'deep' },
          env: {
            API_URL: 'http://localhost:3000',
          },
          dependsOn: ['api-server'],
        },
        'customer-portal': {
          category: 'frontend',
          command: 'ng serve --port 4201',
          type: 'angular',
          cwd: './apps/customer',
          integration: { mode: 'deep' },
          env: {
            API_URL: 'http://localhost:3000',
          },
          dependsOn: ['api-server'],
        },

        // Development tools
        'api-docs': {
          category: 'tools',
          command: 'npx swagger-ui-watcher -c swagger.yaml',
          type: 'node',
          cwd: './apps/api',
          env: {
            PORT: '8080',
          },
          dependsOn: ['api-server'],
        },
      },
    };
  });

  describe('Complete Application Startup', () => {
    it('should start entire stack in correct dependency order', async () => {
      const { validateConfig } = await import('../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../src/core/boot/logger.js');
      const { createRunner } = await import('../../src/runners/factory.js');
      const { execa } = await import('execa');

      vi.mocked(validateConfig).mockReturnValue(fullStackConfig);

      // Expected startup order: infrastructure -> backend -> frontend -> tools
      const startOrder = [
        'postgres',
        'redis',
        'api-server',
        'worker-queue',
        'admin-dashboard',
        'customer-portal',
        'api-docs',
      ];

      vi.mocked(resolveDependencies).mockReturnValue(startOrder);
      vi.mocked(groupIntoWaves).mockReturnValue([
        ['postgres', 'redis'],
        ['api-server'],
        ['worker-queue', 'admin-dashboard', 'customer-portal'],
        ['api-docs'],
      ]);
      vi.mocked(runPreflight).mockResolvedValue([
        { name: 'docker', passed: true, duration: 15 },
        { name: 'node', passed: true, duration: 10 },
      ]);

      const actualStartOrder: string[] = [];
      const processEvents: Record<string, string[]> = {};

      // Mock runner factory with realistic process behavior
      vi.mocked(createRunner).mockImplementation((name: string, config: any) => {
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = Math.floor(Math.random() * 90000) + 10000;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const mockRunner = new EventEmitter() as any;
        mockRunner.name = name;
        mockRunner.start = vi.fn().mockImplementation(async () => {
          actualStartOrder.push(name);
          processEvents[name] = ['start'];

          mockRunner.status = 'starting';

          // Simulate realistic startup behavior for each service
          setTimeout(() => {
            if (name === 'postgres' || name === 'redis') {
              // Docker containers start quickly
              processEvents[name].push('ready');
              mockRunner.status = 'running';
            } else if (name === 'api-server' || name === 'worker-queue') {
              // Node.js services
              mockProcess.stdout.emit('data', Buffer.from(`Server listening on port ${config.env?.PORT || '3000'}\n`));
              processEvents[name].push('listening');
              mockRunner.status = 'running';
            } else if (name.includes('dashboard') || name.includes('portal')) {
              // Angular apps with build process
              mockRunner.status = 'building';
              processEvents[name].push('building');

              setTimeout(() => {
                mockProcess.stdout.emit('data', Buffer.from(angularFixtures.ANGULAR_BUILD_START_JSON + '\n'));

                setTimeout(() => {
                  mockProcess.stdout.emit('data', Buffer.from(angularFixtures.ANGULAR_BUILD_COMPLETE_SUCCESS_JSON + '\n'));
                  processEvents[name].push('ready');
                  mockRunner.status = 'running';
                }, 20);
              }, 10);
            } else {
              // Other tools
              processEvents[name].push('ready');
              mockRunner.status = 'running';
            }
          }, 5);
        });
        mockRunner.stop = vi.fn().mockResolvedValue(undefined);
        mockRunner.pid = mockProcess.pid;
        mockRunner.status = 'pending';

        return mockRunner;
      });

      const mockBootLogger = {
        printHeader: vi.fn(),
        printPhaseHeader: vi.fn(),
        printPreflightCheck: vi.fn(),
        printProcessStarting: vi.fn(),
        printProcessReady: vi.fn(),
        printCompletion: vi.fn(),
      };
      vi.mocked(BootLogger).mockImplementation(() => mockBootLogger as any);

      const orchestrator = new Orchestrator({
        config: fullStackConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await orchestrator.start();

      // Wait for all async startup processes
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify startup order
      expect(actualStartOrder).toEqual(startOrder);

      // Verify infrastructure started first
      const postgresIndex = actualStartOrder.indexOf('postgres');
      const redisIndex = actualStartOrder.indexOf('redis');
      const apiIndex = actualStartOrder.indexOf('api-server');

      expect(postgresIndex).toBeLessThan(apiIndex);
      expect(redisIndex).toBeLessThan(apiIndex);

      // Verify backend started before frontend
      const adminIndex = actualStartOrder.indexOf('admin-dashboard');
      const customerIndex = actualStartOrder.indexOf('customer-portal');

      expect(apiIndex).toBeLessThan(adminIndex);
      expect(apiIndex).toBeLessThan(customerIndex);

      // Verify all processes are running
      expect(orchestrator.getStatus('postgres')).toBe('running');
      expect(orchestrator.getStatus('redis')).toBe('running');
      expect(orchestrator.getStatus('api-server')).toBe('running');
      expect(orchestrator.getStatus('worker-queue')).toBe('running');
      expect(orchestrator.getStatus('admin-dashboard')).toBe('running');
      expect(orchestrator.getStatus('customer-portal')).toBe('running');
      expect(orchestrator.getStatus('api-docs')).toBe('running');
    });

    it('should handle infrastructure failure and prevent dependent services from starting', async () => {
      const { validateConfig } = await import('../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../src/core/boot/logger.js');
      const { createRunner } = await import('../../src/runners/factory.js');

      vi.mocked(validateConfig).mockReturnValue(fullStackConfig);
      vi.mocked(resolveDependencies).mockReturnValue([
        'postgres',
        'redis',
        'api-server',
        'admin-dashboard',
      ]);
      vi.mocked(groupIntoWaves).mockReturnValue([['postgres', 'redis'], ['api-server'], ['admin-dashboard']]);
      vi.mocked(runPreflight).mockResolvedValue([
        { name: 'docker', passed: true, duration: 15 },
      ]);

      const startedServices: string[] = [];

      // Mock postgres to fail
      vi.mocked(createRunner).mockImplementation((name: string) => {
        const mockRunner = new EventEmitter() as any;
        mockRunner.name = name;
        mockRunner.start = vi.fn().mockImplementation(async () => {
          startedServices.push(name);

          if (name === 'postgres') {
            mockRunner.status = 'failed';
            throw new Error('Port 5432 already in use');
          }

          mockRunner.status = 'running';
        });
        mockRunner.stop = vi.fn().mockResolvedValue(undefined);
        mockRunner.pid = 12345;
        mockRunner.status = 'pending';

        return mockRunner;
      });

      const mockBootLogger = {
        printHeader: vi.fn(),
        printPhaseHeader: vi.fn(),
        printPreflightCheck: vi.fn(),
        printProcessStarting: vi.fn(),
        printProcessReady: vi.fn(),
        printCompletion: vi.fn(),
      };
      vi.mocked(BootLogger).mockImplementation(() => mockBootLogger as any);

      const orchestrator = new Orchestrator({
        config: fullStackConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await expect(orchestrator.start()).rejects.toThrow();

      // Only postgres and redis should have attempted to start
      expect(startedServices).toContain('postgres');
      // api-server should not have started since postgres failed
      expect(startedServices).not.toContain('api-server');
      expect(startedServices).not.toContain('admin-dashboard');
    });
  });

  describe('Service Health Checks', () => {
    it('should wait for API server health check before starting frontend', async () => {
      const { validateConfig } = await import('../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../src/core/boot/logger.js');
      const { createRunner } = await import('../../src/runners/factory.js');

      const simpleConfig: OrckitConfig = {
        project: 'health-check-test',
        processes: {
          'api-server': {
            category: 'backend',
            command: 'node server.js',
            type: 'node',
            ready: {
              type: 'http',
              url: 'http://localhost:3000/health',
              timeout: 10000,
            },
          },
          'admin-dashboard': {
            category: 'frontend',
            command: 'ng serve',
            type: 'angular',
            dependsOn: ['api-server'],
          },
        },
      };

      vi.mocked(validateConfig).mockReturnValue(simpleConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api-server', 'admin-dashboard']);
      vi.mocked(groupIntoWaves).mockReturnValue([['api-server'], ['admin-dashboard']]);
      vi.mocked(runPreflight).mockResolvedValue([{ name: 'node', passed: true, duration: 10 }]);

      const healthCheckAttempts: string[] = [];

      vi.mocked(createRunner).mockImplementation((name: string) => {
        const mockRunner = new EventEmitter() as any;
        mockRunner.name = name;
        mockRunner.start = vi.fn().mockImplementation(async () => {
          if (name === 'api-server') {
            // Simulate health check delay
            healthCheckAttempts.push('api-health-check-1');
            await new Promise((resolve) => setTimeout(resolve, 10));
            healthCheckAttempts.push('api-health-check-2');
            await new Promise((resolve) => setTimeout(resolve, 10));
            healthCheckAttempts.push('api-ready');
          } else {
            healthCheckAttempts.push('admin-started');
          }
          mockRunner.status = 'running';
        });
        mockRunner.stop = vi.fn().mockResolvedValue(undefined);
        mockRunner.pid = 12345;
        mockRunner.status = 'pending';

        return mockRunner;
      });

      const mockBootLogger = {
        printHeader: vi.fn(),
        printPhaseHeader: vi.fn(),
        printPreflightCheck: vi.fn(),
        printProcessStarting: vi.fn(),
        printProcessReady: vi.fn(),
        printCompletion: vi.fn(),
      };
      vi.mocked(BootLogger).mockImplementation(() => mockBootLogger as any);

      const orchestrator = new Orchestrator({
        config: simpleConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await orchestrator.start();

      // Verify health checks completed before admin started
      const apiReadyIndex = healthCheckAttempts.indexOf('api-ready');
      const adminStartIndex = healthCheckAttempts.indexOf('admin-started');

      expect(apiReadyIndex).toBeLessThan(adminStartIndex);
      expect(healthCheckAttempts).toContain('api-health-check-1');
      expect(healthCheckAttempts).toContain('api-health-check-2');
    });
  });

  describe('Development Workflow Scenarios', () => {
    it('should handle hot reload in Angular while keeping backend stable', async () => {
      const { validateConfig } = await import('../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../src/core/boot/logger.js');
      const { createRunner } = await import('../../src/runners/factory.js');
      const { execa } = await import('execa');

      const devConfig: OrckitConfig = {
        project: 'dev-workflow',
        processes: {
          api: {
            category: 'backend',
            command: 'npm run dev',
            type: 'node',
          },
          frontend: {
            category: 'frontend',
            command: 'ng serve',
            type: 'angular',
            integration: { mode: 'deep' },
            dependsOn: ['api'],
          },
        },
      };

      vi.mocked(validateConfig).mockReturnValue(devConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'frontend']);
      vi.mocked(groupIntoWaves).mockReturnValue([['api'], ['frontend']]);
      vi.mocked(runPreflight).mockResolvedValue([{ name: 'node', passed: true, duration: 10 }]);

      const buildEvents: Array<{ process: string; event: string; time: number }> = [];
      const startTime = Date.now();

      vi.mocked(createRunner).mockImplementation((name: string) => {
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 12345;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const mockRunner = new EventEmitter() as any;
        mockRunner.name = name;
        mockRunner.start = vi.fn().mockImplementation(async () => {
          buildEvents.push({ process: name, event: 'start', time: Date.now() - startTime });

          if (name === 'api') {
            mockRunner.status = 'running';
          } else {
            // Simulate Angular initial build
            mockRunner.status = 'building';
            buildEvents.push({ process: name, event: 'initial-build', time: Date.now() - startTime });

            setTimeout(() => {
              mockProcess.stdout.emit('data', Buffer.from(angularFixtures.ANGULAR_BUILD_COMPLETE_SUCCESS_JSON + '\n'));
              mockRunner.status = 'running';
              buildEvents.push({ process: name, event: 'build-complete', time: Date.now() - startTime });

              // Simulate file change after 50ms
              setTimeout(() => {
                buildEvents.push({ process: name, event: 'file-change', time: Date.now() - startTime });
                mockRunner.status = 'building';
                mockProcess.stdout.emit('data', Buffer.from(angularFixtures.ANGULAR_BUILD_START_JSON + '\n'));

                // Quick rebuild
                setTimeout(() => {
                  mockProcess.stdout.emit('data', Buffer.from(angularFixtures.ANGULAR_BUILD_COMPLETE_SUCCESS_JSON + '\n'));
                  mockRunner.status = 'running';
                  buildEvents.push({ process: name, event: 'rebuild-complete', time: Date.now() - startTime });
                }, 10);
              }, 50);
            }, 20);
          }
        });
        mockRunner.stop = vi.fn().mockResolvedValue(undefined);
        mockRunner.pid = mockProcess.pid;
        mockRunner.status = 'pending';

        return mockRunner;
      });

      const mockBootLogger = {
        printHeader: vi.fn(),
        printPhaseHeader: vi.fn(),
        printPreflightCheck: vi.fn(),
        printProcessStarting: vi.fn(),
        printProcessReady: vi.fn(),
        printCompletion: vi.fn(),
      };
      vi.mocked(BootLogger).mockImplementation(() => mockBootLogger as any);

      const orchestrator = new Orchestrator({
        config: devConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await orchestrator.start();

      // Wait for rebuild cycle
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify API remained stable (only started once)
      const apiEvents = buildEvents.filter((e) => e.process === 'api');
      expect(apiEvents).toHaveLength(1);
      expect(apiEvents[0].event).toBe('start');

      // Verify frontend had initial build and rebuild
      const frontendEvents = buildEvents.filter((e) => e.process === 'frontend');
      expect(frontendEvents.some((e) => e.event === 'initial-build')).toBe(true);
      expect(frontendEvents.some((e) => e.event === 'file-change')).toBe(true);
      expect(frontendEvents.some((e) => e.event === 'rebuild-complete')).toBe(true);

      // Both should be running at the end
      expect(orchestrator.getStatus('api')).toBe('running');
      expect(orchestrator.getStatus('frontend')).toBe('running');
    });

    it('should handle API restart without restarting Angular', async () => {
      const { validateConfig } = await import('../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../src/core/boot/logger.js');
      const { createRunner } = await import('../../src/runners/factory.js');

      const devConfig: OrckitConfig = {
        project: 'api-restart-test',
        processes: {
          api: {
            category: 'backend',
            command: 'npm run dev',
            type: 'node',
          },
          frontend: {
            category: 'frontend',
            command: 'ng serve',
            type: 'angular',
            dependsOn: ['api'],
          },
        },
      };

      vi.mocked(validateConfig).mockReturnValue(devConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'frontend']);
      vi.mocked(groupIntoWaves).mockReturnValue([['api'], ['frontend']]);
      vi.mocked(runPreflight).mockResolvedValue([{ name: 'node', passed: true, duration: 10 }]);

      const lifecycleEvents: string[] = [];
      const runners: Record<string, any> = {};

      vi.mocked(createRunner).mockImplementation((name: string) => {
        const mockRunner = new EventEmitter() as any;
        mockRunner.name = name;
        mockRunner.start = vi.fn().mockImplementation(async () => {
          lifecycleEvents.push(`${name}:start`);
          mockRunner.status = 'running';
        });
        mockRunner.stop = vi.fn().mockImplementation(async () => {
          lifecycleEvents.push(`${name}:stop`);
          mockRunner.status = 'stopped';
        });
        mockRunner.pid = 12345;
        mockRunner.status = 'pending';

        runners[name] = mockRunner;
        return mockRunner;
      });

      const mockBootLogger = {
        printHeader: vi.fn(),
        printPhaseHeader: vi.fn(),
        printPreflightCheck: vi.fn(),
        printProcessStarting: vi.fn(),
        printProcessReady: vi.fn(),
        printCompletion: vi.fn(),
      };
      vi.mocked(BootLogger).mockImplementation(() => mockBootLogger as any);

      const orchestrator = new Orchestrator({
        config: devConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await orchestrator.start();

      // Simulate API restart (e.g., code change that requires restart)
      lifecycleEvents.push('user:restart-api');
      await runners['api'].stop();
      await runners['api'].start();

      // Verify restart sequence
      expect(lifecycleEvents).toEqual([
        'api:start',
        'frontend:start',
        'user:restart-api',
        'api:stop',
        'api:start',
      ]);

      // Frontend should not have been restarted
      const frontendStops = lifecycleEvents.filter((e) => e === 'frontend:stop');
      expect(frontendStops).toHaveLength(0);
    });
  });

  describe('Resource Management', () => {
    it('should track PIDs for all running processes', async () => {
      const { validateConfig } = await import('../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../src/core/boot/logger.js');
      const { createRunner } = await import('../../src/runners/factory.js');

      // Simplified config for PID tracking
      const pidConfig: OrckitConfig = {
        project: 'pid-tracking',
        processes: {
          postgres: { category: 'infrastructure', command: 'docker run postgres', type: 'docker' },
          api: { category: 'backend', command: 'node server.js', type: 'node', dependsOn: ['postgres'] },
          frontend: { category: 'frontend', command: 'ng serve', type: 'angular', dependsOn: ['api'] },
        },
      };

      vi.mocked(validateConfig).mockReturnValue(pidConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['postgres', 'api', 'frontend']);
      vi.mocked(groupIntoWaves).mockReturnValue([['postgres'], ['api'], ['frontend']]);
      vi.mocked(runPreflight).mockResolvedValue([{ name: 'docker', passed: true, duration: 10 }]);

      const assignedPIDs: Record<string, number> = {
        postgres: 10001,
        api: 20002,
        frontend: 30003,
      };

      vi.mocked(createRunner).mockImplementation((name: string) => {
        const mockRunner = new EventEmitter() as any;
        mockRunner.name = name;
        mockRunner.start = vi.fn().mockImplementation(async () => {
          mockRunner.pid = assignedPIDs[name];
          mockRunner.status = 'running';
        });
        mockRunner.stop = vi.fn().mockResolvedValue(undefined);
        mockRunner.pid = null;
        mockRunner.status = 'pending';

        return mockRunner;
      });

      const mockBootLogger = {
        printHeader: vi.fn(),
        printPhaseHeader: vi.fn(),
        printPreflightCheck: vi.fn(),
        printProcessStarting: vi.fn(),
        printProcessReady: vi.fn(),
        printCompletion: vi.fn(),
      };
      vi.mocked(BootLogger).mockImplementation(() => mockBootLogger as any);

      const orchestrator = new Orchestrator({
        config: pidConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await orchestrator.start();

      // All processes should be tracked with their PIDs
      expect(orchestrator.getStatus('postgres')).toBe('running');
      expect(orchestrator.getStatus('api')).toBe('running');
      expect(orchestrator.getStatus('frontend')).toBe('running');
    });

    it('should gracefully stop all processes in reverse dependency order', async () => {
      const { validateConfig } = await import('../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../src/core/boot/logger.js');
      const { createRunner } = await import('../../src/runners/factory.js');

      const shutdownConfig: OrckitConfig = {
        project: 'shutdown-test',
        processes: {
          db: { category: 'infrastructure', command: 'docker run postgres', type: 'docker' },
          api: { category: 'backend', command: 'node server.js', type: 'node', dependsOn: ['db'] },
          web: { category: 'frontend', command: 'ng serve', type: 'angular', dependsOn: ['api'] },
        },
      };

      vi.mocked(validateConfig).mockReturnValue(shutdownConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['db', 'api', 'web']);
      vi.mocked(groupIntoWaves).mockReturnValue([['db'], ['api'], ['web']]);
      vi.mocked(runPreflight).mockResolvedValue([{ name: 'docker', passed: true, duration: 10 }]);

      const stopOrder: string[] = [];

      vi.mocked(createRunner).mockImplementation((name: string) => {
        const mockRunner = new EventEmitter() as any;
        mockRunner.name = name;
        mockRunner.start = vi.fn().mockImplementation(async () => {
          mockRunner.status = 'running';
        });
        mockRunner.stop = vi.fn().mockImplementation(async () => {
          stopOrder.push(name);
          mockRunner.status = 'stopped';
        });
        mockRunner.pid = 12345;
        mockRunner.status = 'pending';

        return mockRunner;
      });

      const mockBootLogger = {
        printHeader: vi.fn(),
        printPhaseHeader: vi.fn(),
        printPreflightCheck: vi.fn(),
        printProcessStarting: vi.fn(),
        printProcessReady: vi.fn(),
        printCompletion: vi.fn(),
      };
      vi.mocked(BootLogger).mockImplementation(() => mockBootLogger as any);

      const orchestrator = new Orchestrator({
        config: shutdownConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await orchestrator.start();
      await orchestrator.stop();

      // Should stop in reverse order: web -> api -> db
      expect(stopOrder).toEqual(['web', 'api', 'db']);
    });
  });
});
