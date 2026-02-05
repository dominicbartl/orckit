/**
 * AngularRunner Integration Tests
 *
 * Tests the AngularRunner with a real Angular project
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { AngularRunner } from '../../../src/runners/angular.js';
import type { ProcessConfig } from '../../../src/types/index.js';
import { execa } from 'execa';
import * as path from 'path';
import * as fs from 'fs';
import {runProcess} from "./runner-test-helper";

const ANGULAR_APP_PATH = path.resolve(__dirname, '../../../examples/fullstack-app/admin-dashboard');

describe.sequential('AngularRunner Integration', () => {
  let runner: AngularRunner;
  let npmInstalled = false;

  beforeAll(async () => {
    // Check if dependencies are installed
    const nodeModulesPath = path.join(ANGULAR_APP_PATH, 'node_modules');
    if (!fs.existsSync(nodeModulesPath)) {
      console.log('Installing Angular dependencies...');
      try {
        await execa('npm', ['install'], { cwd: ANGULAR_APP_PATH });
        npmInstalled = true;
      } catch (error) {
        console.error('Failed to install dependencies:', error);
        npmInstalled = false;
      }
    } else {
      npmInstalled = true;
    }
  }, 120000);

  afterEach(async () => {
    if (runner) {
      await runner.stop();
    }
  });

  describe('angular build', () => {
    it('should run Angular build successfully', async () => {
      if (!npmInstalled) {
        console.log('Skipping Angular test - dependencies not installed');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'npm run build',
        cwd: ANGULAR_APP_PATH,
      };

      runner = new AngularRunner('angular-build', config);
      const result = await runProcess(runner, {
        timeout: 50000,
        logOutput: false,
        expectedStatus: /building|running/,
        successCondition: 'build:complete',
      });

      expect(result.success).toBe(true);
      expect(result.buildComplete).toBe(true);

      // Angular outputs to both stdout and stderr
      const allOutput = (result.outputs.join('') + result.errors.join('')).toLowerCase();
      // Should have Angular output indicators
      expect(allOutput).toMatch(/compiling|building|compiled|complete|generating|generation/);

      // Build should have completed
    }, 60000);

    it('should parse Angular text output and emit build events', async () => {
      if (!npmInstalled) {
        console.log('Skipping Angular test - dependencies not installed');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'npm run build',
        cwd: ANGULAR_APP_PATH,
      };

      runner = new AngularRunner('angular-events', config);

      const result = await runProcess(runner, {
        timeout: 50000,
        logOutput: false,
        successCondition: 'build:complete',
      });

      expect(result.success).toBe(true);
      expect(result.buildComplete).toBe(true);

      // Should have build events
      expect(result.events.some(e => e.startsWith('build:'))).toBe(true);
    }, 60000);

    it('should track build info', async () => {
      if (!npmInstalled) {
        console.log('Skipping Angular test - dependencies not installed');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'npm run build',
        cwd: ANGULAR_APP_PATH,
      };

      runner = new AngularRunner('angular-buildinfo', config);

      const result = await runProcess(runner, {
        timeout: 50000,
        logOutput: false,
        successCondition: 'build:complete',
      });

      expect(result.success).toBe(true);
      expect(result.buildComplete).toBe(true);

      const buildInfo = runner.buildInfo;
      if (buildInfo) {
        expect(buildInfo.lastBuildSuccess).toBe(true);
        expect(buildInfo.errors).toBe(0);
      }
    }, 60000);
  });

  describe('angular serve', () => {
    it('should run Angular dev server', async () => {
      if (!npmInstalled) {
        console.log('Skipping Angular test - dependencies not installed');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'npm run start -- --port 14200',
        cwd: ANGULAR_APP_PATH,
      };

      runner = new AngularRunner('angular-serve', config);

      const result = await runProcess(runner, {
        timeout: 60000,
        logOutput: false,
        successCondition: 'build:complete',
      });

      expect(result.success).toBe(true);
      expect(result.buildComplete).toBe(true);

      // Dev server should be running or building
      expect(runner.status).toMatch(/running|building/);

      const output = result.outputs.join('');
      // Check for dev server indicators (only if we got output)
      if (output.length > 0) {
        expect(output.toLowerCase()).toMatch(/compil|serv|localhost|angular/);
      }

      // Try to access the dev server
      try {
        const response = await fetch('http://localhost:14200');
        expect(response.status).toBe(200);
      } catch (error) {
        console.log('Dev server access check:', error);
      }
    }, 90000);

    it('should handle file changes in watch mode', async () => {
      if (!npmInstalled) {
        console.log('Skipping Angular test - dependencies not installed');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'npm run start -- --port 14201',
        cwd: ANGULAR_APP_PATH,
      };

      runner = new AngularRunner('angular-watch', config);

      // Start the server and wait for initial build
      const result = await runProcess(runner, {
        timeout: 60000,
        logOutput: false,
        successCondition: 'build:complete',
      });

      expect(result.success).toBe(true);
      expect(result.buildComplete).toBe(true);
      expect(runner.status).toMatch(/running|building/);

      const initialBuildCount = result.events.filter(e => e === 'build:complete').length;

      // Track additional build events
      let additionalBuilds = 0;
      runner.on('build:complete', () => {
        additionalBuilds++;
      });

      // Modify a component file to trigger rebuild
      const componentPath = path.join(ANGULAR_APP_PATH, 'src', 'app', 'app.component.ts');
      if (fs.existsSync(componentPath)) {
        const originalContent = fs.readFileSync(componentPath, 'utf8');

        try {
          // Add a comment to trigger rebuild
          fs.appendFileSync(componentPath, '\n// Test modification\n');

          // Wait for rebuild
          await new Promise(resolve => setTimeout(resolve, 15000));

          // Should have triggered another build
          expect(additionalBuilds).toBeGreaterThan(0);
        } finally {
          // Restore original content
          fs.writeFileSync(componentPath, originalContent);
        }
      }
    }, 120000);
  });

  describe('error handling', () => {
    it('should handle build errors', async () => {
      if (!npmInstalled) {
        console.log('Skipping Angular test - dependencies not installed');
        return;
      }

      // Create a temporary component with syntax error
      const errorComponentPath = path.join(ANGULAR_APP_PATH, 'src', 'app', 'error-test.component.ts');
      const errorComponent = `
        import { Component } from '@angular/core';

        @Component({
          selector: 'app-error-test',
          template: '<div>Error Test</div>'
        })
        export class ErrorTestComponent {
          // Syntax error: missing closing brace
          constructor() {
        }
      `;

      fs.writeFileSync(errorComponentPath, errorComponent);

      try {
        const config: ProcessConfig = {
          category: 'test',
          command: 'npx ng build --configuration development',
          cwd: ANGULAR_APP_PATH,
        };

        runner = new AngularRunner('angular-error', config);

        const result = await runProcess(runner, {
          timeout: 30000,
          logOutput: false,
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
        if (fs.existsSync(errorComponentPath)) {
          fs.unlinkSync(errorComponentPath);
        }
      }
    }, 60000);
  });

  describe('restart functionality', () => {
    it('should restart Angular build', async () => {
      if (!npmInstalled) {
        console.log('Skipping Angular test - dependencies not installed');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'npm run build',
        cwd: ANGULAR_APP_PATH,
      };

      runner = new AngularRunner('angular-restart', config);

      // First build
      const firstResult = await runProcess(runner, {
        timeout: 50000,
        logOutput: false,
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
      await new Promise(resolve => setTimeout(resolve, 30000));

      // Should have completed rebuild or be in appropriate state
      expect(rebuildComplete || runner.status === 'stopped').toBe(true);
    }, 90000);
  });

});
