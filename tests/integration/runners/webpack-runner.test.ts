/**
 * WebpackRunner Integration Tests
 *
 * Tests the WebpackRunner with a real webpack project
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { WebpackRunner } from '../../../src/runners/webpack.js';
import type { ProcessConfig } from '../../../src/types/index.js';
import { execa } from 'execa';
import * as path from 'path';
import * as fs from 'fs';
import { runProcess } from './runner-test-helper.js';

const WEBPACK_APP_PATH = path.resolve(__dirname, '../../../examples/webpack-app');

describe('WebpackRunner Integration', () => {
  let runner: WebpackRunner;
  let npmInstalled = false;

  beforeAll(async () => {
    // Check if dependencies are installed
    const nodeModulesPath = path.join(WEBPACK_APP_PATH, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      console.log('Installing webpack dependencies...');
      try {
        await execa('npm', ['install'], { cwd: WEBPACK_APP_PATH });
        npmInstalled = true;
      } catch (error) {
        console.error('Failed to install dependencies:', error);
        npmInstalled = false;
      }
    } else {
      npmInstalled = true;
    }
  }, 60000);

  afterEach(async () => {
    if (runner) {
      await runner.stop();
    }
  });

  describe('webpack build', () => {
    it('should run webpack build successfully', async () => {
      if (!npmInstalled) {
        console.log('Skipping webpack test - dependencies not installed');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'npm run build',
        cwd: WEBPACK_APP_PATH,
      };

      runner = new WebpackRunner('webpack-build', config);

      const result = await runProcess(runner, {
        timeout: 15000,
        expectedStatus: /building|running/,
        successCondition: 'build:complete',
      });

      expect(result.success).toBe(true);
      expect(result.buildComplete).toBe(true);

      const output = result.outputs.join('');
      expect(output.toLowerCase()).toMatch(/webpack|compiled|bundle/);

      // Check if bundle was created
      const bundlePath = path.join(WEBPACK_APP_PATH, 'dist', 'bundle.js');
      expect(fs.existsSync(bundlePath)).toBe(true);
    }, 30000);

    it('should parse webpack output and emit build events', async () => {
      if (!npmInstalled) {
        console.log('Skipping webpack test - dependencies not installed');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'npm run build',
        cwd: WEBPACK_APP_PATH,
      };

      runner = new WebpackRunner('webpack-events', config);

      let buildInfo: any = null;
      runner.on('build:complete', (data) => {
        buildInfo = data.buildInfo;
      });

      const result = await runProcess(runner, {
        timeout: 15000,
        trackEvents: ['build:start', 'build:complete'],
        successCondition: 'build:complete',
      });

      expect(result.success).toBe(true);
      expect(result.events.some(e => e.includes('build:start') || e.includes('build:complete'))).toBe(true);

      if (buildInfo) {
        expect(buildInfo).toHaveProperty('errors');
        expect(buildInfo).toHaveProperty('warnings');
        expect(buildInfo.errors).toBe(0);
      }
    }, 30000);

    it('should track build info', async () => {
      if (!npmInstalled) {
        console.log('Skipping webpack test - dependencies not installed');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'npm run build',
        cwd: WEBPACK_APP_PATH,
      };

      runner = new WebpackRunner('webpack-buildinfo', config);

      const result = await runProcess(runner, {
        timeout: 15000,
        successCondition: 'build:complete',
      });

      expect(result.success).toBe(true);

      const buildInfo = runner.buildInfo;
      if (buildInfo) {
        expect(buildInfo.lastBuildSuccess).toBe(true);
        expect(buildInfo.errors).toBe(0);
      }
    }, 30000);
  });

  describe('webpack watch mode', () => {
    it('should run webpack in watch mode', async () => {
      if (!npmInstalled) {
        console.log('Skipping webpack test - dependencies not installed');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'npm run watch',
        cwd: WEBPACK_APP_PATH,
      };

      runner = new WebpackRunner('webpack-watch', config);

      // Start and wait for initial build
      const result = await runProcess(runner, {
        timeout: 5000,
        successCondition: 'build:complete',
      });

      expect(result.success).toBe(true);
      expect(result.buildComplete).toBe(true);
      expect(runner.status).toBe('running');

      // Track additional builds
      let additionalBuilds = 0;
      runner.on('build:complete', () => {
        additionalBuilds++;
      });

      // Modify source file to trigger rebuild
      const srcPath = path.join(WEBPACK_APP_PATH, 'src', 'index.js');
      const originalContent = fs.readFileSync(srcPath, 'utf8');

      try {
        fs.appendFileSync(srcPath, '\n// Modified for test\n');

        // Wait for rebuild
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Should have triggered another build
        expect(additionalBuilds).toBeGreaterThan(0);
      } finally {
        // Restore original content
        fs.writeFileSync(srcPath, originalContent);
      }
    }, 45000);
  });

  describe('error handling', () => {
    it('should handle build errors gracefully', async () => {
      if (!npmInstalled) {
        console.log('Skipping webpack test - dependencies not installed');
        return;
      }

      // Create a temporary file with syntax error
      const errorFilePath = path.join(WEBPACK_APP_PATH, 'src', 'error.js');
      fs.writeFileSync(errorFilePath, 'import { invalid syntax here');

      // Update webpack entry to use error file
      const configPath = path.join(WEBPACK_APP_PATH, 'webpack.config.js');
      const originalConfig = fs.readFileSync(configPath, 'utf8');
      const errorConfig = originalConfig.replace("'./src/index.js'", "'./src/error.js'");
      fs.writeFileSync(configPath, errorConfig);

      try {
        const config: ProcessConfig = {
          category: 'test',
          command: 'npm run build',
          cwd: WEBPACK_APP_PATH,
        };

        runner = new WebpackRunner('webpack-error', config);

        const result = await runProcess(runner, {
          timeout: 5000,
          successCondition: 'custom',
          customSuccessCheck: (res) => {
            // Success means we detected the build failure
            return res.events.includes('build:failed') || runner.status === 'failed';
          },
        });

        // Should have detected failure
        expect(result.success).toBe(true);
        expect(result.events.includes('build:failed') || runner.status === 'failed').toBe(true);
      } finally {
        // Cleanup
        fs.unlinkSync(errorFilePath);
        fs.writeFileSync(configPath, originalConfig);
      }
    }, 30000);
  });

  describe('restart functionality', () => {
    it('should restart webpack build', async () => {
      if (!npmInstalled) {
        console.log('Skipping webpack test - dependencies not installed');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'npm run build',
        cwd: WEBPACK_APP_PATH,
      };

      runner = new WebpackRunner('webpack-restart', config);

      // First build
      const firstResult = await runProcess(runner, {
        timeout: 5000,
        successCondition: 'build:complete',
      });

      expect(firstResult.success).toBe(true);
      expect(runner.restartCount).toBe(0);

      // Track additional build events after restart
      let rebuildComplete = false;
      runner.on('build:complete', () => {
        rebuildComplete = true;
      });

      // Restart
      await runner.restart();
      expect(runner.restartCount).toBe(1);

      // Wait for rebuild
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Should have completed rebuild or be in appropriate state
      expect(rebuildComplete || runner.status === 'stopped').toBe(true);
    }, 45000);
  });
});
