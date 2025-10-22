import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { Orchestrator } from '../../src/core/orchestrator.js';
import type { OrckitConfig } from '../../src/types/index.js';
import * as fixtures from '../fixtures/angular-json-output.js';

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

describe('Angular E2E - Orchestration Tests', () => {
  let mockConfig: OrckitConfig;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      project: 'angular-app',
      processes: {
        api: {
          category: 'backend',
          command: 'node server.js',
          type: 'node',
        },
        angular: {
          category: 'frontend',
          command: 'ng serve',
          type: 'angular',
          integration: { mode: 'deep' },
          dependsOn: ['api'],
        },
      },
    };
  });

  describe('Angular with Backend Dependencies', () => {
    it('should start backend before Angular app', async () => {
      const { validateConfig } = await import('../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../src/core/boot/logger.js');
      const { createRunner } = await import('../../src/runners/factory.js');
      const { execa } = await import('execa');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'angular']);
      vi.mocked(groupIntoWaves).mockReturnValue([['api'], ['angular']]);
      vi.mocked(runPreflight).mockResolvedValue([
        { name: 'node', passed: true, duration: 10 },
      ]);

      const startOrder: string[] = [];

      // Mock runner factory to track start order
      vi.mocked(createRunner).mockImplementation((name: string, config: any) => {
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = name === 'api' ? 11111 : 22222;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        const mockRunner = new EventEmitter() as any;
        mockRunner.name = name;
        mockRunner.start = vi.fn().mockImplementation(async () => {
          startOrder.push(name);

          if (name === 'angular') {
            // Simulate Angular build process
            setTimeout(() => {
              mockProcess.stdout.emit(
                'data',
                Buffer.from(fixtures.ANGULAR_BUILD_START_JSON + '\n')
              );
              setTimeout(() => {
                mockProcess.stdout.emit(
                  'data',
                  Buffer.from(fixtures.ANGULAR_BUILD_COMPLETE_SUCCESS_JSON + '\n')
                );
              }, 10);
            }, 5);
          }

          mockRunner.status = 'running';
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
        config: mockConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await orchestrator.start();

      // Verify start order
      expect(startOrder).toEqual(['api', 'angular']);
      expect(orchestrator.getStatus('api')).toBe('running');
      expect(orchestrator.getStatus('angular')).toBe('running');
    });

    it('should fail Angular startup if backend fails', async () => {
      const { validateConfig } = await import('../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../src/core/boot/logger.js');
      const { createRunner } = await import('../../src/runners/factory.js');

      vi.mocked(validateConfig).mockReturnValue(mockConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['api', 'angular']);
      vi.mocked(groupIntoWaves).mockReturnValue([['api'], ['angular']]);
      vi.mocked(runPreflight).mockResolvedValue([
        { name: 'node', passed: true, duration: 10 },
      ]);

      // Mock runner factory
      vi.mocked(createRunner).mockImplementation((name: string) => {
        const mockRunner = new EventEmitter() as any;
        mockRunner.name = name;
        mockRunner.start = vi.fn().mockImplementation(async () => {
          if (name === 'api') {
            mockRunner.status = 'failed';
            throw new Error('Port 3000 already in use');
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
        config: mockConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await expect(orchestrator.start()).rejects.toThrow();
      // When a process fails during startup, orchestrator throws before updating status
    });
  });

  describe('Angular Build Monitoring', () => {
    it('should monitor Angular build progress through orchestrator', async () => {
      const { validateConfig } = await import('../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../src/core/boot/logger.js');
      const { createRunner } = await import('../../src/runners/factory.js');
      const { execa } = await import('execa');

      const angularOnlyConfig: OrckitConfig = {
        project: 'angular-app',
        processes: {
          angular: {
            category: 'frontend',
            command: 'ng serve',
            type: 'angular',
            integration: { mode: 'deep' },
          },
        },
      };

      vi.mocked(validateConfig).mockReturnValue(angularOnlyConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['angular']);
      vi.mocked(groupIntoWaves).mockReturnValue([['angular']]);
      vi.mocked(runPreflight).mockResolvedValue([
        { name: 'node', passed: true, duration: 10 },
      ]);

      const buildEvents: string[] = [];

      // Mock Angular runner with full build cycle
      vi.mocked(createRunner).mockImplementation(() => {
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 22222;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const mockRunner = new EventEmitter() as any;
        mockRunner.name = 'angular';
        mockRunner.start = vi.fn().mockImplementation(async () => {
          buildEvents.push('start');
          mockRunner.status = 'building';

          // Simulate build sequence
          setTimeout(() => {
            buildEvents.push('build-start');
            mockProcess.stdout.emit('data', Buffer.from(fixtures.ANGULAR_BUILD_START_JSON + '\n'));

            setTimeout(() => {
              buildEvents.push('build-progress');
              for (const progress of fixtures.ANGULAR_BUILD_PROGRESS_JSON) {
                mockProcess.stdout.emit('data', Buffer.from(progress + '\n'));
              }

              setTimeout(() => {
                buildEvents.push('build-complete');
                mockProcess.stdout.emit(
                  'data',
                  Buffer.from(fixtures.ANGULAR_BUILD_COMPLETE_SUCCESS_JSON + '\n')
                );
                mockRunner.status = 'running';
              }, 10);
            }, 10);
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
        config: angularOnlyConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await orchestrator.start();

      // Wait for async events to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(buildEvents).toContain('start');
      expect(buildEvents).toContain('build-start');
      expect(buildEvents).toContain('build-progress');
      expect(buildEvents).toContain('build-complete');
      expect(orchestrator.getStatus('angular')).toBe('running');
    });

    it('should handle Angular build failures gracefully', async () => {
      const { validateConfig } = await import('../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../src/core/boot/logger.js');
      const { createRunner } = await import('../../src/runners/factory.js');
      const { execa } = await import('execa');

      const angularOnlyConfig: OrckitConfig = {
        project: 'angular-app',
        processes: {
          angular: {
            category: 'frontend',
            command: 'ng build --prod',
            type: 'angular',
            integration: { mode: 'deep' },
          },
        },
      };

      vi.mocked(validateConfig).mockReturnValue(angularOnlyConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['angular']);
      vi.mocked(groupIntoWaves).mockReturnValue([['angular']]);
      vi.mocked(runPreflight).mockResolvedValue([
        { name: 'node', passed: true, duration: 10 },
      ]);

      // Mock Angular runner with failed build
      vi.mocked(createRunner).mockImplementation(() => {
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 22222;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const mockRunner = new EventEmitter() as any;
        mockRunner.name = 'angular';
        mockRunner.start = vi.fn().mockImplementation(async () => {
          mockRunner.status = 'building';

          setTimeout(() => {
            mockProcess.stdout.emit('data', Buffer.from(fixtures.ANGULAR_BUILD_START_JSON + '\n'));

            setTimeout(() => {
              mockProcess.stdout.emit(
                'data',
                Buffer.from(fixtures.ANGULAR_BUILD_COMPLETE_WITH_ERRORS_JSON + '\n')
              );
              mockRunner.status = 'failed';
            }, 10);
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
        config: angularOnlyConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await orchestrator.start();

      // Wait for async events
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(orchestrator.getStatus('angular')).toBe('failed');
    });
  });

  describe('Multi-Angular Configuration', () => {
    it('should handle multiple Angular apps with different ports', async () => {
      const { validateConfig } = await import('../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../src/core/boot/logger.js');
      const { createRunner } = await import('../../src/runners/factory.js');

      const multiAngularConfig: OrckitConfig = {
        project: 'multi-angular',
        processes: {
          'angular-admin': {
            category: 'frontend',
            command: 'ng serve --port 4200',
            type: 'angular',
            integration: { mode: 'deep' },
          },
          'angular-public': {
            category: 'frontend',
            command: 'ng serve --port 4201',
            type: 'angular',
            integration: { mode: 'deep' },
          },
        },
      };

      vi.mocked(validateConfig).mockReturnValue(multiAngularConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['angular-admin', 'angular-public']);
      vi.mocked(groupIntoWaves).mockReturnValue([['angular-admin', 'angular-public']]);
      vi.mocked(runPreflight).mockResolvedValue([
        { name: 'node', passed: true, duration: 10 },
      ]);

      const startedApps: string[] = [];

      vi.mocked(createRunner).mockImplementation((name: string) => {
        const mockRunner = new EventEmitter() as any;
        mockRunner.name = name;
        mockRunner.start = vi.fn().mockImplementation(async () => {
          startedApps.push(name);
          mockRunner.status = 'running';
        });
        mockRunner.stop = vi.fn().mockResolvedValue(undefined);
        mockRunner.pid = name === 'angular-admin' ? 11111 : 22222;
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
        config: multiAngularConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await orchestrator.start();

      expect(startedApps).toContain('angular-admin');
      expect(startedApps).toContain('angular-public');
      expect(orchestrator.getStatus('angular-admin')).toBe('running');
      expect(orchestrator.getStatus('angular-public')).toBe('running');
    });
  });

  describe('Angular Watch Mode', () => {
    it('should handle file changes and rebuilds in watch mode', async () => {
      const { validateConfig } = await import('../../src/core/config/parser.js');
      const { resolveDependencies, groupIntoWaves } = await import(
        '../../src/core/dependency/resolver.js'
      );
      const { runPreflight } = await import('../../src/core/preflight/runner.js');
      const { BootLogger } = await import('../../src/core/boot/logger.js');
      const { createRunner } = await import('../../src/runners/factory.js');
      const { execa } = await import('execa');

      const watchConfig: OrckitConfig = {
        project: 'angular-watch',
        processes: {
          angular: {
            category: 'frontend',
            command: 'ng serve --watch',
            type: 'angular',
          },
        },
      };

      vi.mocked(validateConfig).mockReturnValue(watchConfig);
      vi.mocked(resolveDependencies).mockReturnValue(['angular']);
      vi.mocked(groupIntoWaves).mockReturnValue([['angular']]);
      vi.mocked(runPreflight).mockResolvedValue([
        { name: 'node', passed: true, duration: 10 },
      ]);

      const rebuilds: string[] = [];

      vi.mocked(createRunner).mockImplementation(() => {
        const mockProcess = new EventEmitter() as any;
        mockProcess.pid = 22222;
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();

        vi.mocked(execa).mockReturnValue(mockProcess);

        const mockRunner = new EventEmitter() as any;
        mockRunner.name = 'angular';
        mockRunner.start = vi.fn().mockImplementation(async () => {
          mockRunner.status = 'building';

          // Initial build
          setTimeout(() => {
            rebuilds.push('initial');
            mockProcess.stdout.emit('data', Buffer.from(fixtures.ANGULAR_TEXT_BUILD_SUCCESS));
            mockRunner.status = 'running';

            // Simulate file change after initial build
            setTimeout(() => {
              rebuilds.push('rebuild-start');
              mockRunner.status = 'building';
              mockProcess.stdout.emit(
                'data',
                Buffer.from(fixtures.ANGULAR_TEXT_WEBPACK_COMPILING)
              );

              setTimeout(() => {
                rebuilds.push('rebuild-complete');
                mockProcess.stdout.emit('data', Buffer.from(fixtures.ANGULAR_TEXT_REBUILD));
                mockRunner.status = 'running';
              }, 10);
            }, 10);
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
        config: watchConfig,
        enableTmux: false,
        enableStatusMonitor: false,
      });

      await orchestrator.start();

      // Wait for rebuild cycle
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(rebuilds).toContain('initial');
      expect(rebuilds).toContain('rebuild-start');
      expect(rebuilds).toContain('rebuild-complete');
      expect(orchestrator.getStatus('angular')).toBe('running');
    });
  });
});
