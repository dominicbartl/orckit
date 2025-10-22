import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { AngularRunner } from '../../src/runners/angular.js';
import type { ProcessConfig } from '../../src/types/index.js';
import * as fixtures from '../fixtures/angular-json-output.js';

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock system utils
vi.mock('../../src/utils/system.js', () => ({
  getProcessEnv: vi.fn((env) => ({ ...process.env, ...env })),
}));

describe('Angular Runner Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('JSON Mode - Complete Build Lifecycle', () => {
    it('should handle complete successful build flow', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng serve',
        type: 'angular',
        integration: { mode: 'deep' },
      };

      const runner = new AngularRunner('angular', config);

      // Track events
      const events: string[] = [];
      runner.on('build:start', () => events.push('build:start'));
      runner.on('build:progress', () => events.push('build:progress'));
      runner.on('build:complete', () => events.push('build:complete'));

      await runner.start();

      // Simulate complete build flow
      mockProcess.stdout.emit('data', Buffer.from(fixtures.ANGULAR_BUILD_START_JSON + '\n'));

      // Emit progress events
      for (const progress of fixtures.ANGULAR_BUILD_PROGRESS_JSON) {
        mockProcess.stdout.emit('data', Buffer.from(progress + '\n'));
      }

      // Build complete
      mockProcess.stdout.emit(
        'data',
        Buffer.from(fixtures.ANGULAR_BUILD_COMPLETE_SUCCESS_JSON + '\n')
      );

      expect(events).toContain('build:start');
      expect(events).toContain('build:progress');
      expect(events).toContain('build:complete');
      expect(runner.status).toBe('running');
      expect(runner.buildInfo?.errors).toBe(0);
      expect(runner.buildInfo?.warnings).toBe(0);
      expect(runner.buildInfo?.lastBuildSuccess).toBe(true);
    });

    it('should handle build with warnings', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng build',
        type: 'angular',
        integration: { mode: 'deep' },
      };

      const runner = new AngularRunner('angular', config);

      const buildCompleteEvents: any[] = [];
      runner.on('build:complete', (data) => buildCompleteEvents.push(data));

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from(fixtures.ANGULAR_BUILD_START_JSON + '\n'));
      mockProcess.stdout.emit(
        'data',
        Buffer.from(fixtures.ANGULAR_BUILD_COMPLETE_WITH_WARNINGS_JSON + '\n')
      );

      expect(buildCompleteEvents.length).toBeGreaterThan(0);
      expect(runner.buildInfo?.warnings).toBe(2);
      expect(runner.buildInfo?.errors).toBe(0);
      expect(runner.buildInfo?.lastBuildSuccess).toBe(true);
      expect(runner.status).toBe('running');
    });

    it('should handle build with compilation errors', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng build --prod',
        type: 'angular',
        integration: { mode: 'deep' },
      };

      const runner = new AngularRunner('angular', config);

      const buildCompleteEvents: any[] = [];
      runner.on('build:complete', (data) => buildCompleteEvents.push(data));

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from(fixtures.ANGULAR_BUILD_START_JSON + '\n'));
      mockProcess.stdout.emit(
        'data',
        Buffer.from(fixtures.ANGULAR_BUILD_COMPLETE_WITH_ERRORS_JSON + '\n')
      );

      expect(buildCompleteEvents.length).toBeGreaterThan(0);
      expect(runner.buildInfo?.errors).toBe(2);
      expect(runner.buildInfo?.warnings).toBe(1);
      expect(runner.buildInfo?.lastBuildSuccess).toBe(false);
      expect(runner.status).toBe('failed');
    });

    it('should handle fatal build errors', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng serve',
        type: 'angular',
        integration: { mode: 'deep' },
      };

      const runner = new AngularRunner('angular', config);

      const buildFailedEvents: any[] = [];
      runner.on('build:failed', (data) => buildFailedEvents.push(data));

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from(fixtures.ANGULAR_BUILD_ERROR_JSON + '\n'));

      expect(buildFailedEvents.length).toBeGreaterThan(0);
      expect(runner.status).toBe('failed');
    });

    it('should track build duration correctly', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng build',
        type: 'angular',
        integration: { mode: 'deep' },
      };

      const runner = new AngularRunner('angular', config);

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from(fixtures.ANGULAR_BUILD_START_JSON + '\n'));
      mockProcess.stdout.emit(
        'data',
        Buffer.from(fixtures.ANGULAR_BUILD_COMPLETE_SUCCESS_JSON + '\n')
      );

      expect(runner.buildInfo?.duration).toBe(2547);
    });
  });

  describe('Text Mode - Fallback Parsing', () => {
    it('should detect successful build from simple pattern', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular', config);

      const buildCompleteEvents: any[] = [];
      runner.on('build:complete', (data) => buildCompleteEvents.push(data));

      await runner.start();

      // Use pattern that Angular runner actually looks for
      mockProcess.stdout.emit('data', Buffer.from('Compiled successfully.\n'));

      expect(buildCompleteEvents.length).toBeGreaterThan(0);
      expect(runner.status).toBe('running');
      expect(runner.buildInfo?.lastBuildSuccess).toBe(true);
    });

    it('should detect build complete pattern', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng build',
        type: 'angular',
      };

      const runner = new AngularRunner('angular', config);

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from('Build complete\n'));

      expect(runner.status).toBe('running');
    });

    it('should detect compilation errors', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng build',
        type: 'angular',
      };

      const runner = new AngularRunner('angular', config);

      const buildFailedEvents: any[] = [];
      runner.on('build:failed', (data) => buildFailedEvents.push(data));

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from('ERROR in src/app/app.component.ts\n'));

      expect(buildFailedEvents.length).toBeGreaterThan(0);
      expect(runner.status).toBe('failed');
    });

    it('should detect server listening from compiled message', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular', config);

      await runner.start();

      // Server listening is detected via "Compiled successfully" message
      mockProcess.stdout.emit('data', Buffer.from('Compiled successfully.\n'));

      expect(runner.status).toBe('running');
    });

    it('should handle rebuild cycle in watch mode', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular', config);

      const buildStartEvents: any[] = [];
      const buildCompleteEvents: any[] = [];

      runner.on('build:start', (data) => buildStartEvents.push(data));
      runner.on('build:complete', (data) => buildCompleteEvents.push(data));

      await runner.start();

      // Initial build
      mockProcess.stdout.emit('data', Buffer.from('Compiled successfully.\n'));

      expect(runner.status).toBe('running');
      expect(buildCompleteEvents.length).toBeGreaterThan(0);

      // File change triggers rebuild (uses "Compiling" pattern)
      mockProcess.stdout.emit('data', Buffer.from('Compiling...\n'));
      expect(buildStartEvents.length).toBeGreaterThan(0);

      // Rebuild completes
      mockProcess.stdout.emit('data', Buffer.from('Compiled successfully.\n'));
      expect(runner.status).toBe('running');
    });
  });

  describe('Mode Switching', () => {
    it('should use JSON parsing when deep integration mode is enabled', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng serve',
        type: 'angular',
        integration: { mode: 'deep' },
      };

      const runner = new AngularRunner('angular', config);

      await runner.start();

      // Send JSON - should be parsed
      mockProcess.stdout.emit('data', Buffer.from(fixtures.ANGULAR_BUILD_START_JSON + '\n'));

      expect(runner.status).toBe('building');

      // Send text - should be ignored in JSON mode
      mockProcess.stdout.emit('data', Buffer.from('Some random text output\n'));

      // Status should remain building (not affected by text)
      expect(runner.status).toBe('building');
    });

    it('should use text parsing when no integration mode is specified', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular', config);

      await runner.start();

      // Send text - should be parsed
      mockProcess.stdout.emit('data', Buffer.from('Compiled successfully.\n'));

      expect(runner.status).toBe('running');
    });
  });

  describe('Progress Tracking', () => {
    it('should track incremental build progress in JSON mode', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng build',
        type: 'angular',
        integration: { mode: 'deep' },
      };

      const runner = new AngularRunner('angular', config);

      const progressValues: number[] = [];
      runner.on('build:progress', (data) => {
        if (data.progress !== undefined) {
          progressValues.push(data.progress);
        }
      });

      await runner.start();

      mockProcess.stdout.emit('data', Buffer.from(fixtures.ANGULAR_BUILD_START_JSON + '\n'));

      // Emit all progress events
      for (const progress of fixtures.ANGULAR_BUILD_PROGRESS_JSON) {
        mockProcess.stdout.emit('data', Buffer.from(progress + '\n'));
      }

      expect(progressValues).toEqual([10, 25, 50, 75, 90]);
    });

    it('should detect compilation phase in text mode', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng build',
        type: 'angular',
      };

      const runner = new AngularRunner('angular', config);

      const buildStartEvents: any[] = [];
      runner.on('build:start', (data) => buildStartEvents.push(data));

      await runner.start();

      // Emit compilation start indicator (uses "Building" pattern)
      mockProcess.stdout.emit('data', Buffer.from('Building application...\n'));

      expect(buildStartEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Error Recovery', () => {
    it('should recover from malformed JSON in deep mode', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng serve',
        type: 'angular',
        integration: { mode: 'deep' },
      };

      const runner = new AngularRunner('angular', config);

      await runner.start();

      // Send valid JSON
      mockProcess.stdout.emit('data', Buffer.from(fixtures.ANGULAR_BUILD_START_JSON + '\n'));
      expect(runner.status).toBe('building');

      // Send malformed JSON - should not crash
      mockProcess.stdout.emit('data', Buffer.from('{ invalid json\n'));

      // Send valid JSON again - should still work
      mockProcess.stdout.emit(
        'data',
        Buffer.from(fixtures.ANGULAR_BUILD_COMPLETE_SUCCESS_JSON + '\n')
      );

      expect(runner.status).toBe('running');
    });

    it('should continue after encountering unexpected text patterns', async () => {
      const { execa } = await import('execa');
      const mockProcess = new EventEmitter() as any;
      mockProcess.pid = 12345;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();

      vi.mocked(execa).mockReturnValue(mockProcess);

      const config: ProcessConfig = {
        category: 'frontend',
        command: 'ng serve',
        type: 'angular',
      };

      const runner = new AngularRunner('angular', config);

      await runner.start();

      // Send random text that doesn't match patterns
      mockProcess.stdout.emit('data', Buffer.from('Random console.log output\n'));
      mockProcess.stdout.emit('data', Buffer.from('More random text\n'));

      // Send valid completion message
      mockProcess.stdout.emit('data', Buffer.from('Compiled successfully.\n'));

      expect(runner.status).toBe('running');
    });
  });
});
