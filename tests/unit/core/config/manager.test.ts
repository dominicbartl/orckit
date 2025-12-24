/**
 * Tests for ConfigManager
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigManager } from '../../../../src/core/config/manager.js';
import type { OrckitConfig } from '../../../../src/types/index.js';

describe('ConfigManager', () => {
  describe('constructor', () => {
    it('should require either configPath or config', () => {
      expect(() => new ConfigManager({})).toThrow(
        'ConfigManager requires either configPath or config'
      );
    });

    it('should accept a config object', () => {
      const config: OrckitConfig = {
        project: 'test-project',
        processes: {
          api: {
            category: 'backend',
            command: 'node server.js',
          },
        },
      };

      const manager = new ConfigManager({ config });

      // Config gets normalized with defaults, so check key properties
      const result = manager.getConfig();
      expect(result.project).toBe('test-project');
      expect(result.processes.api.category).toBe('backend');
      expect(result.processes.api.command).toBe('node server.js');
      expect(manager.getProjectName()).toBe('test-project');
    });

    it('should use default project name when not specified', () => {
      const config: OrckitConfig = {
        processes: {
          api: {
            category: 'backend',
            command: 'node server.js',
          },
        },
      };

      const manager = new ConfigManager({ config });

      expect(manager.getProjectName()).toBe('orckit');
    });
  });

  describe('dependency resolution', () => {
    it('should resolve dependencies in correct order', () => {
      const config: OrckitConfig = {
        project: 'test',
        processes: {
          frontend: {
            category: 'ui',
            command: 'npm run dev',
            dependencies: ['api'],
          },
          api: {
            category: 'backend',
            command: 'node server.js',
            dependencies: ['db'],
          },
          db: {
            category: 'database',
            command: 'docker compose up db',
          },
        },
      };

      const manager = new ConfigManager({ config });
      const order = manager.getStartOrder();

      // db should come before api, api before frontend
      expect(order.indexOf('db')).toBeLessThan(order.indexOf('api'));
      expect(order.indexOf('api')).toBeLessThan(order.indexOf('frontend'));
    });

    it('should group processes into waves', () => {
      const config: OrckitConfig = {
        project: 'test',
        processes: {
          frontend: {
            category: 'ui',
            command: 'npm run dev',
            dependencies: ['api'],
          },
          api: {
            category: 'backend',
            command: 'node server.js',
          },
          worker: {
            category: 'backend',
            command: 'node worker.js',
          },
        },
      };

      const manager = new ConfigManager({ config });
      const waves = manager.getWaves();

      // api and worker have no dependencies, should be in wave 0
      // frontend depends on api, should be in wave 1
      expect(waves.length).toBe(2);
      expect(waves[0]).toContain('api');
      expect(waves[0]).toContain('worker');
      expect(waves[1]).toContain('frontend');
    });

    it('should detect circular dependencies', () => {
      const config: OrckitConfig = {
        project: 'test',
        processes: {
          a: {
            category: 'test',
            command: 'echo a',
            dependencies: ['b'],
          },
          b: {
            category: 'test',
            command: 'echo b',
            dependencies: ['a'],
          },
        },
      };

      expect(() => new ConfigManager({ config })).toThrow(/[Cc]ircular/);
    });

    it('should detect missing dependencies', () => {
      const config: OrckitConfig = {
        project: 'test',
        processes: {
          api: {
            category: 'backend',
            command: 'node server.js',
            dependencies: ['nonexistent'],
          },
        },
      };

      expect(() => new ConfigManager({ config })).toThrow(/nonexistent/);
    });
  });

  describe('process queries', () => {
    const config: OrckitConfig = {
      project: 'test',
      processes: {
        api: {
          category: 'backend',
          command: 'node server.js',
        },
        frontend: {
          category: 'ui',
          command: 'npm run dev',
          dependencies: ['api'],
        },
        worker: {
          category: 'backend',
          command: 'node worker.js',
        },
      },
    };

    it('should return process names', () => {
      const manager = new ConfigManager({ config });
      const names = manager.getProcessNames();

      expect(names).toContain('api');
      expect(names).toContain('frontend');
      expect(names).toContain('worker');
      expect(names).toHaveLength(3);
    });

    it('should check if process exists', () => {
      const manager = new ConfigManager({ config });

      expect(manager.hasProcess('api')).toBe(true);
      expect(manager.hasProcess('nonexistent')).toBe(false);
    });

    it('should return process config', () => {
      const manager = new ConfigManager({ config });

      const apiConfig = manager.getProcessConfig('api');
      expect(apiConfig).toBeDefined();
      expect(apiConfig?.command).toBe('node server.js');
      expect(apiConfig?.category).toBe('backend');

      const nonexistent = manager.getProcessConfig('nonexistent');
      expect(nonexistent).toBeUndefined();
    });

    it('should return process category', () => {
      const manager = new ConfigManager({ config });

      expect(manager.getProcessCategory('api')).toBe('backend');
      expect(manager.getProcessCategory('frontend')).toBe('ui');
    });

    it('should return transitive dependencies', () => {
      const config: OrckitConfig = {
        project: 'test',
        processes: {
          a: {
            category: 'test',
            command: 'echo a',
            dependencies: ['b'],
          },
          b: {
            category: 'test',
            command: 'echo b',
            dependencies: ['c'],
          },
          c: {
            category: 'test',
            command: 'echo c',
          },
        },
      };

      const manager = new ConfigManager({ config });
      const deps = manager.getDependencies('a');

      expect(deps).toContain('b');
      expect(deps).toContain('c');
      expect(deps).toHaveLength(2);
    });
  });

  describe('filterStartOrder', () => {
    const config: OrckitConfig = {
      project: 'test',
      processes: {
        frontend: {
          category: 'ui',
          command: 'npm run dev',
          dependencies: ['api'],
        },
        api: {
          category: 'backend',
          command: 'node server.js',
          dependencies: ['db'],
        },
        db: {
          category: 'database',
          command: 'docker compose up db',
        },
        worker: {
          category: 'backend',
          command: 'node worker.js',
        },
      },
    };

    it('should return all processes when no filter specified', () => {
      const manager = new ConfigManager({ config });
      const order = manager.filterStartOrder();

      expect(order).toHaveLength(4);
    });

    it('should return process and its dependencies', () => {
      const manager = new ConfigManager({ config });
      const order = manager.filterStartOrder(['frontend']);

      // frontend depends on api, which depends on db
      expect(order).toContain('frontend');
      expect(order).toContain('api');
      expect(order).toContain('db');
      expect(order).not.toContain('worker');
      expect(order).toHaveLength(3);
    });

    it('should throw for unknown process', () => {
      const manager = new ConfigManager({ config });

      expect(() => manager.filterStartOrder(['nonexistent'])).toThrow(
        'Unknown process: nonexistent'
      );
    });

    it('should maintain dependency order', () => {
      const manager = new ConfigManager({ config });
      const order = manager.filterStartOrder(['frontend']);

      expect(order.indexOf('db')).toBeLessThan(order.indexOf('api'));
      expect(order.indexOf('api')).toBeLessThan(order.indexOf('frontend'));
    });
  });

  describe('filterWaves', () => {
    const config: OrckitConfig = {
      project: 'test',
      processes: {
        frontend: {
          category: 'ui',
          command: 'npm run dev',
          dependencies: ['api'],
        },
        api: {
          category: 'backend',
          command: 'node server.js',
        },
        worker: {
          category: 'backend',
          command: 'node worker.js',
        },
      },
    };

    it('should return all waves when no filter specified', () => {
      const manager = new ConfigManager({ config });
      const waves = manager.filterWaves();

      expect(waves).toHaveLength(2);
    });

    it('should filter waves to only requested processes', () => {
      const manager = new ConfigManager({ config });
      const waves = manager.filterWaves(['frontend']);

      // Should only include api and frontend, in correct waves
      expect(waves).toHaveLength(2);
      expect(waves[0]).toContain('api');
      expect(waves[0]).not.toContain('worker');
      expect(waves[1]).toContain('frontend');
    });
  });

  describe('getDependencyGraph', () => {
    it('should return ASCII visualization', () => {
      const config: OrckitConfig = {
        project: 'test',
        processes: {
          api: {
            category: 'backend',
            command: 'node server.js',
            dependencies: ['db'],
          },
          db: {
            category: 'database',
            command: 'docker compose up db',
          },
        },
      };

      const manager = new ConfigManager({ config });
      const graph = manager.getDependencyGraph();

      expect(typeof graph).toBe('string');
      expect(graph).toContain('api');
      expect(graph).toContain('db');
    });
  });

  describe('boot and preflight config', () => {
    it('should return boot config', () => {
      const config: OrckitConfig = {
        project: 'test',
        processes: {},
        maestro: {
          boot: {
            style: 'dashboard',
            show_preflight: true,
          },
        },
      };

      const manager = new ConfigManager({ config });
      const bootConfig = manager.getBootConfig();

      expect(bootConfig?.style).toBe('dashboard');
      expect(bootConfig?.show_preflight).toBe(true);
    });

    it('should return undefined when no boot config', () => {
      const config: OrckitConfig = {
        project: 'test',
        processes: {},
      };

      const manager = new ConfigManager({ config });
      expect(manager.getBootConfig()).toBeUndefined();
    });

    it('should return preflight config', () => {
      const config: OrckitConfig = {
        project: 'test',
        processes: {},
        preflight: {
          checks: [
            {
              name: 'custom-check',
              command: 'echo ok',
              error: 'Check failed',
            },
          ],
        },
      };

      const manager = new ConfigManager({ config });
      const preflightConfig = manager.getPreflightConfig();

      expect(preflightConfig?.checks).toHaveLength(1);
      expect(preflightConfig?.checks?.[0].name).toBe('custom-check');
    });

    it('should return global hooks', () => {
      const config: OrckitConfig = {
        project: 'test',
        processes: {},
        hooks: {
          pre_start_all: 'echo starting',
          post_start_all: 'echo started',
        },
      };

      const manager = new ConfigManager({ config });
      const hooks = manager.getGlobalHooks();

      expect(hooks?.pre_start_all).toBe('echo starting');
      expect(hooks?.post_start_all).toBe('echo started');
    });
  });
});
