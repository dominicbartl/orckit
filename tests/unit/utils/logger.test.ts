import { describe, it, expect, vi, beforeEach } from 'vitest';
import stripAnsi from 'strip-ansi';
import {
  ProcessLogger,
  getProcessColor,
  formatDuration,
  formatUptime,
  formatBytes,
  createProgressBar,
  StatusIcons,
  getStatusIcon,
} from '../../../src/utils/logger.js';
import type { OutputConfig } from '../../../src/types/index.js';

describe('Logger Utils', () => {
  describe('ProcessLogger', () => {
    describe('formatLine', () => {
      it('should format basic line with process name', () => {
        const logger = new ProcessLogger('api');
        const result = logger.formatLine('Server started');

        expect(result).toBeDefined();
        const stripped = stripAnsi(result!);
        expect(stripped).toContain('[api]');
        expect(stripped).toContain('Server started');
      });

      it('should add timestamp when enabled', () => {
        const config: OutputConfig = {
          format: {
            timestamp: true,
          },
        };
        const logger = new ProcessLogger('api', config);
        const result = logger.formatLine('Test message');

        expect(result).toBeDefined();
        const stripped = stripAnsi(result!);
        expect(stripped).toMatch(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]/);
      });

      it('should use custom prefix', () => {
        const config: OutputConfig = {
          format: {
            prefix: 'MY-API',
          },
        };
        const logger = new ProcessLogger('api', config);
        const result = logger.formatLine('Test');

        const stripped = stripAnsi(result!);
        expect(stripped).toContain('[MY-API]');
        expect(stripped).not.toContain('[api]');
      });

      it('should suppress lines matching suppress_patterns', () => {
        const config: OutputConfig = {
          filter: {
            suppress_patterns: ['DEBUG', 'verbose'],
          },
        };
        const logger = new ProcessLogger('api', config);

        expect(logger.formatLine('DEBUG: test')).toBeNull();
        expect(logger.formatLine('verbose output')).toBeNull();
        expect(logger.formatLine('INFO: test')).toBeDefined();
      });

      it('should only include lines matching include_patterns', () => {
        const config: OutputConfig = {
          filter: {
            include_patterns: ['ERROR', 'WARN'],
          },
        };
        const logger = new ProcessLogger('api', config);

        expect(logger.formatLine('ERROR: failed')).toBeDefined();
        expect(logger.formatLine('WARN: warning')).toBeDefined();
        expect(logger.formatLine('INFO: test')).toBeNull();
        expect(logger.formatLine('DEBUG: test')).toBeNull();
      });

      it('should highlight patterns', () => {
        const config: OutputConfig = {
          filter: {
            highlight_patterns: [
              { pattern: 'ERROR', color: 'red' },
              { pattern: 'SUCCESS', color: 'green' },
            ],
          },
        };
        const logger = new ProcessLogger('api', config);

        const result1 = logger.formatLine('ERROR: Something failed');
        expect(result1).toBeDefined();
        // Highlighted text should have ANSI codes
        expect(result1).toContain('ERROR');

        const result2 = logger.formatLine('SUCCESS: All good');
        expect(result2).toBeDefined();
        expect(result2).toContain('SUCCESS');
      });

      it('should handle case-insensitive highlighting', () => {
        const config: OutputConfig = {
          filter: {
            highlight_patterns: [{ pattern: 'error', color: 'red' }],
          },
        };
        const logger = new ProcessLogger('api', config);

        const result = logger.formatLine('ERROR: failed');
        expect(result).toBeDefined();
      });

      it('should use custom color', () => {
        const logger = new ProcessLogger('api', {}, '#ff0000');
        const result = logger.formatLine('Test');

        expect(result).toBeDefined();
        expect(result).toContain('[api]');
      });
    });

    describe('buffer management', () => {
      it('should buffer formatted lines', () => {
        const logger = new ProcessLogger('api');

        logger.formatLine('Line 1');
        logger.formatLine('Line 2');
        logger.formatLine('Line 3');

        const buffer = logger.getBuffer();
        expect(buffer).toHaveLength(3);
      });

      it('should respect max_lines limit', () => {
        const config: OutputConfig = {
          format: {
            max_lines: 5,
          },
        };
        const logger = new ProcessLogger('api', config);

        for (let i = 1; i <= 10; i++) {
          logger.formatLine(`Line ${i}`);
        }

        const buffer = logger.getBuffer();
        expect(buffer).toHaveLength(5);
        // Should keep the most recent lines
        const stripped = buffer.map(stripAnsi).join('\n');
        expect(stripped).toContain('Line 10');
        expect(stripped).toContain('Line 6');
        expect(stripped).not.toContain('Line 5');
      });

      it('should default to 1000 max lines', () => {
        const logger = new ProcessLogger('api');

        for (let i = 1; i <= 1001; i++) {
          logger.formatLine(`Line ${i}`);
        }

        const buffer = logger.getBuffer();
        expect(buffer).toHaveLength(1000);
      });

      it('should clear buffer', () => {
        const logger = new ProcessLogger('api');

        logger.formatLine('Line 1');
        logger.formatLine('Line 2');

        expect(logger.getBuffer()).toHaveLength(2);

        logger.clearBuffer();

        expect(logger.getBuffer()).toHaveLength(0);
      });

      it('should not buffer suppressed lines', () => {
        const config: OutputConfig = {
          filter: {
            suppress_patterns: ['DEBUG'],
          },
        };
        const logger = new ProcessLogger('api', config);

        logger.formatLine('INFO: test');
        logger.formatLine('DEBUG: test');
        logger.formatLine('ERROR: test');

        const buffer = logger.getBuffer();
        expect(buffer).toHaveLength(2);
      });
    });

    describe('color mapping', () => {
      it('should map color names to chalk colors', () => {
        const colors = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'];

        colors.forEach((color) => {
          const config: OutputConfig = {
            filter: {
              highlight_patterns: [{ pattern: 'TEST', color }],
            },
          };
          const logger = new ProcessLogger('api', config);
          const result = logger.formatLine('TEST message');
          expect(result).toBeDefined();
        });
      });

      it('should handle unknown color names gracefully', () => {
        const config: OutputConfig = {
          filter: {
            highlight_patterns: [{ pattern: 'TEST', color: 'unknowncolor' }],
          },
        };
        const logger = new ProcessLogger('api', config);
        const result = logger.formatLine('TEST message');
        expect(result).toBeDefined();
      });

      it('should handle case-insensitive color names', () => {
        const config: OutputConfig = {
          filter: {
            highlight_patterns: [{ pattern: 'TEST', color: 'RED' }],
          },
        };
        const logger = new ProcessLogger('api', config);
        const result = logger.formatLine('TEST message');
        expect(result).toBeDefined();
      });
    });
  });

  describe('getProcessColor', () => {
    it('should return consistent color for same process name', () => {
      const color1 = getProcessColor('api');
      const color2 = getProcessColor('api');
      expect(color1).toBe(color2);
    });

    it('should return different colors for different names', () => {
      const color1 = getProcessColor('api');
      const color2 = getProcessColor('frontend');
      const color3 = getProcessColor('database');

      // At least some should be different (though with 10 colors, collisions possible)
      const colors = new Set([color1, color2, color3]);
      expect(colors.size).toBeGreaterThan(1);
    });

    it('should return valid hex color', () => {
      const color = getProcessColor('test-process');
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('should handle empty string', () => {
      const color = getProcessColor('');
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('should handle long process names', () => {
      const color = getProcessColor('very-long-process-name-that-goes-on-and-on');
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  describe('formatDuration', () => {
    it('should format milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms');
      expect(formatDuration(999)).toBe('999ms');
    });

    it('should format seconds', () => {
      expect(formatDuration(1000)).toBe('1s');
      expect(formatDuration(5000)).toBe('5s');
      expect(formatDuration(59000)).toBe('59s');
    });

    it('should format minutes', () => {
      expect(formatDuration(60000)).toBe('1m');
      expect(formatDuration(120000)).toBe('2m');
      expect(formatDuration(90000)).toBe('1m 30s');
      expect(formatDuration(150000)).toBe('2m 30s');
    });

    it('should format hours', () => {
      expect(formatDuration(3600000)).toBe('1h');
      expect(formatDuration(7200000)).toBe('2h');
      expect(formatDuration(3660000)).toBe('1h 1m');
      expect(formatDuration(7320000)).toBe('2h 2m');
    });

    it('should handle zero', () => {
      expect(formatDuration(0)).toBe('0ms');
    });
  });

  describe('formatUptime', () => {
    it('should format uptime from start time', () => {
      const now = new Date();
      const startTime = new Date(now.getTime() - 5000); // 5 seconds ago

      const uptime = formatUptime(startTime);
      expect(uptime).toMatch(/[45]s/); // Should be around 4-5s
    });

    it('should handle recent start time', () => {
      const now = new Date();
      const startTime = new Date(now.getTime() - 100); // 100ms ago

      const uptime = formatUptime(startTime);
      expect(uptime).toContain('ms');
    });

    it('should handle longer uptimes', () => {
      const now = new Date();
      const startTime = new Date(now.getTime() - 3600000); // 1 hour ago

      const uptime = formatUptime(startTime);
      expect(uptime).toContain('h');
    });
  });

  describe('formatBytes', () => {
    it('should format bytes', () => {
      expect(formatBytes(500)).toBe('500B');
      expect(formatBytes(1023)).toBe('1023B');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1.0KB');
      expect(formatBytes(2048)).toBe('2.0KB');
      expect(formatBytes(1536)).toBe('1.5KB');
    });

    it('should format megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0MB');
      expect(formatBytes(2 * 1024 * 1024)).toBe('2.0MB');
      expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5MB');
    });

    it('should format gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0GB');
      expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5GB');
    });

    it('should handle zero', () => {
      expect(formatBytes(0)).toBe('0B');
    });

    it('should round to 1 decimal place', () => {
      expect(formatBytes(1536)).toBe('1.5KB');
      expect(formatBytes(1587)).toBe('1.5KB'); // Should round down
    });
  });

  describe('createProgressBar', () => {
    it('should create progress bar with default width', () => {
      const bar = createProgressBar(50);
      expect(bar).toHaveLength(20);
      expect(bar).toContain('█');
      expect(bar).toContain('░');
    });

    it('should create progress bar with custom width', () => {
      const bar = createProgressBar(50, 10);
      expect(bar).toHaveLength(10);
    });

    it('should show 0% progress', () => {
      const bar = createProgressBar(0, 10);
      expect(bar).toBe('░'.repeat(10));
    });

    it('should show 100% progress', () => {
      const bar = createProgressBar(100, 10);
      expect(bar).toBe('█'.repeat(10));
    });

    it('should show 50% progress', () => {
      const bar = createProgressBar(50, 10);
      expect(bar).toBe('█'.repeat(5) + '░'.repeat(5));
    });

    it('should handle decimal progress', () => {
      const bar = createProgressBar(25.5, 10);
      // Should floor to 25% = 2 filled
      expect(bar).toBe('██░░░░░░░░');
    });
  });

  describe('StatusIcons', () => {
    it('should have all status icons defined', () => {
      expect(StatusIcons.pending).toBeDefined();
      expect(StatusIcons.starting).toBeDefined();
      expect(StatusIcons.running).toBeDefined();
      expect(StatusIcons.building).toBeDefined();
      expect(StatusIcons.failed).toBeDefined();
      expect(StatusIcons.stopped).toBeDefined();
    });

    it('should be unicode symbols', () => {
      Object.values(StatusIcons).forEach((icon) => {
        expect(typeof icon).toBe('string');
        expect(icon.length).toBeGreaterThan(0);
      });
    });
  });

  describe('getStatusIcon', () => {
    it('should return colored running icon', () => {
      const icon = getStatusIcon('running');
      expect(icon).toBeDefined();
      expect(stripAnsi(icon)).toBe(StatusIcons.running);
    });

    it('should return colored failed icon', () => {
      const icon = getStatusIcon('failed');
      expect(icon).toBeDefined();
      expect(stripAnsi(icon)).toBe(StatusIcons.failed);
    });

    it('should return colored starting icon', () => {
      const icon = getStatusIcon('starting');
      expect(icon).toBeDefined();
      expect(stripAnsi(icon)).toBe(StatusIcons.starting);
    });

    it('should return colored building icon', () => {
      const icon = getStatusIcon('building');
      expect(icon).toBeDefined();
      expect(stripAnsi(icon)).toBe(StatusIcons.building);
    });

    it('should return colored stopped icon', () => {
      const icon = getStatusIcon('stopped');
      expect(icon).toBeDefined();
      expect(stripAnsi(icon)).toBe(StatusIcons.stopped);
    });

    it('should return pending icon', () => {
      const icon = getStatusIcon('pending');
      expect(icon).toBeDefined();
      expect(stripAnsi(icon)).toBe(StatusIcons.pending);
    });

    it('should apply different colors to different statuses', () => {
      const running = getStatusIcon('running');
      const failed = getStatusIcon('failed');

      // Running should be green, failed should be red
      expect(running).not.toBe(failed);
      // But the stripped icon should be the same
      expect(stripAnsi(running)).toBe(StatusIcons.running);
      expect(stripAnsi(failed)).toBe(StatusIcons.failed);
    });
  });
});
