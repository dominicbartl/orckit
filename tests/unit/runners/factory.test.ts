import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/runners/factory.js';
import { BashRunner } from '../../../src/runners/bash.js';
import { DockerRunner } from '../../../src/runners/docker.js';
import { NodeRunner } from '../../../src/runners/node.js';
import { WebpackRunner } from '../../../src/runners/webpack.js';
import { AngularRunner } from '../../../src/runners/angular.js';
import { ViteRunner } from '../../../src/runners/vite.js';
import type { ProcessConfig } from '../../../src/types/index.js';

describe('Runner Factory', () => {
  describe('createRunner', () => {
    it('should create BashRunner for bash type', () => {
      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
        type: 'bash',
      };

      const runner = createRunner('test-process', config);
      expect(runner).toBeInstanceOf(BashRunner);
    });

    it('should create BashRunner when type is not specified', () => {
      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
      };

      const runner = createRunner('test-process', config);
      expect(runner).toBeInstanceOf(BashRunner);
    });

    it('should create DockerRunner for docker type', () => {
      const config: ProcessConfig = {
        category: 'infrastructure',
        command: 'docker run postgres',
        type: 'docker',
      };

      const runner = createRunner('postgres', config);
      expect(runner).toBeInstanceOf(DockerRunner);
    });

    it('should create NodeRunner for node type', () => {
      const config: ProcessConfig = {
        category: 'backend',
        command: 'node server.js',
        type: 'node',
      };

      const runner = createRunner('api', config);
      expect(runner).toBeInstanceOf(NodeRunner);
    });

    it('should create NodeRunner for ts-node type', () => {
      const config: ProcessConfig = {
        category: 'backend',
        command: 'ts-node src/server.ts',
        type: 'ts-node',
      };

      const runner = createRunner('api', config);
      expect(runner).toBeInstanceOf(NodeRunner);
    });

    it('should create WebpackRunner for webpack type', () => {
      const config: ProcessConfig = {
        category: 'frontend',
        command: 'webpack --watch',
        type: 'webpack',
      };

      const runner = createRunner('webpack', config);
      expect(runner).toBeInstanceOf(WebpackRunner);
    });

    it('should create WebpackRunner for build type', () => {
      const config: ProcessConfig = {
        category: 'frontend',
        command: 'npm run build',
        type: 'build',
      };

      const runner = createRunner('build', config);
      expect(runner).toBeInstanceOf(WebpackRunner);
    });

    it('should create AngularRunner for angular type', () => {
      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng serve',
        type: 'angular',
      };

      const runner = createRunner('angular-app', config);
      expect(runner).toBeInstanceOf(AngularRunner);
    });

    it('should create ViteRunner for vite type', () => {
      const config: ProcessConfig = {
        category: 'frontend',
        command: 'vite',
        type: 'vite',
      };

      const runner = createRunner('vite-app', config);
      expect(runner).toBeInstanceOf(ViteRunner);
    });

    it('should throw error for unknown process type', () => {
      const config: ProcessConfig = {
        category: 'backend',
        command: 'unknown command',
        type: 'unknown-type' as any,
      };

      expect(() => createRunner('test', config)).toThrow('Unknown process type: unknown-type');
    });

    it('should pass process name to runner', () => {
      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
      };

      const runner = createRunner('my-api', config);
      expect(runner).toBeDefined();
      // The name should be stored in the runner
    });

    it('should pass config to runner', () => {
      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
        cwd: '/custom/path',
        env: { NODE_ENV: 'production' },
      };

      const runner = createRunner('api', config);
      expect(runner).toBeDefined();
      // The config should be stored in the runner
    });

    it('should handle all lifecycle hook properties', () => {
      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
        hooks: {
          pre_start: 'npm install',
          post_start: 'echo "Started"',
          pre_stop: 'npm run cleanup',
          post_stop: 'echo "Stopped"',
        },
      };

      const runner = createRunner('api', config);
      expect(runner).toBeInstanceOf(BashRunner);
    });

    it('should handle ready check configuration', () => {
      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
        ready: {
          type: 'http',
          url: 'http://localhost:3000/health',
        },
      };

      const runner = createRunner('api', config);
      expect(runner).toBeInstanceOf(BashRunner);
    });

    it('should handle restart policy', () => {
      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
        restart: 'on-failure',
        max_retries: 3,
      };

      const runner = createRunner('api', config);
      expect(runner).toBeInstanceOf(BashRunner);
    });

    it('should handle dependencies', () => {
      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
        dependencies: ['postgres', 'redis'],
      };

      const runner = createRunner('api', config);
      expect(runner).toBeInstanceOf(BashRunner);
    });

    it('should handle output configuration', () => {
      const config: ProcessConfig = {
        category: 'backend',
        command: 'npm start',
        output: {
          filter: {
            suppress_patterns: ['DEBUG'],
            highlight_patterns: [{ pattern: 'ERROR', color: 'red' }],
          },
          format: {
            timestamp: true,
            prefix: 'API',
          },
        },
      };

      const runner = createRunner('api', config);
      expect(runner).toBeInstanceOf(BashRunner);
    });
  });
});
