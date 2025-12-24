import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OrckitConfig } from '../../../../src/types/index.js';

// Mock system utilities - use relative path matching the source imports
vi.mock('../../../../src/utils/system.js', () => ({
  isDockerRunning: vi.fn(),
  getNodeVersion: vi.fn(),
}));

// Mock port utilities
vi.mock('../../../../src/utils/port.js', () => ({
  checkPorts: vi.fn().mockResolvedValue([]),
  extractPorts: vi.fn().mockReturnValue([]),
  formatPortConflictMessage: vi.fn().mockReturnValue(''),
}));

// Mock config parser - use the path as seen from the checks.ts module
vi.mock('../../../../src/core/config/parser.js', () => ({
  extractPorts: vi.fn().mockReturnValue([]),
  hasDockerProcesses: vi.fn().mockReturnValue(false),
}));

// Mock interactive handlers
vi.mock('../../../../src/core/preflight/interactive.js', () => ({
  handlePortConflicts: vi.fn().mockResolvedValue(true),
  handleDockerNotRunning: vi.fn().mockResolvedValue(true),
}));

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Import after mocks are set up (hoisting handles this)
import { runPreflight } from '../../../../src/core/preflight/runner.js';

describe('Preflight Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runPreflight', () => {
    it('should run all built-in checks by default', async () => {
      const { getNodeVersion } = await import('../../../../src/utils/system.js');

      vi.mocked(getNodeVersion).mockReturnValue({ major: 20, minor: 0, patch: 0 });

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
      };

      const results = await runPreflight(config);

      // Should include node_version and port_availability checks (docker skipped)
      const checkNames = results.map((r) => r.name);
      expect(checkNames).toContain('node_version');
      expect(checkNames).toContain('port_availability');
      expect(checkNames).not.toContain('docker_daemon'); // Conditional check skipped
    });

    it('should include docker check when config has docker processes', async () => {
      const { getNodeVersion, isDockerRunning } = await import('../../../../src/utils/system.js');
      const { hasDockerProcesses } = await import('../../../../src/core/config/parser.js');

      vi.mocked(getNodeVersion).mockReturnValue({ major: 20, minor: 0, patch: 0 });
      vi.mocked(isDockerRunning).mockResolvedValue(true);
      vi.mocked(hasDockerProcesses).mockReturnValue(true);

      const config: OrckitConfig = {
        processes: {
          db: { category: 'infrastructure', type: 'docker', command: 'docker run postgres' },
        },
      };

      const results = await runPreflight(config);

      const checkNames = results.map((r) => r.name);
      expect(checkNames).toContain('docker_daemon');
    });

    it('should run port availability checks', async () => {
      const { getNodeVersion } = await import('../../../../src/utils/system.js');
      const { extractPorts } = await import('../../../../src/core/config/parser.js');
      const { checkPorts } = await import('../../../../src/utils/port.js');

      vi.mocked(getNodeVersion).mockReturnValue({ major: 20, minor: 0, patch: 0 });
      vi.mocked(extractPorts).mockReturnValue([3000]);
      vi.mocked(checkPorts).mockResolvedValue([]);

      const config: OrckitConfig = {
        processes: {
          api: {
            category: 'backend',
            command: 'npm start',
            ready: { type: 'tcp', host: 'localhost', port: 3000 },
          },
        },
      };

      const results = await runPreflight(config);

      const portCheck = results.find((r) => r.name === 'port_availability');
      expect(portCheck).toBeDefined();
      expect(portCheck?.passed).toBe(true);
      expect(checkPorts).toHaveBeenCalledWith([3000]);
    });

    it('should include custom checks from config', async () => {
      const { getNodeVersion } = await import('../../../../src/utils/system.js');
      const { execa } = await import('execa');

      vi.mocked(getNodeVersion).mockReturnValue({ major: 20, minor: 0, patch: 0 });
      vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as any);

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
        preflight: {
          checks: [
            {
              name: 'custom_check',
              command: 'test -f package.json',
              error: 'package.json not found',
              fix: 'Run npm init',
            },
          ],
        },
      };

      const results = await runPreflight(config);

      const customCheck = results.find((r) => r.name === 'custom_check');
      expect(customCheck).toBeDefined();
      expect(customCheck?.passed).toBe(true);
    });

    it('should measure check duration', async () => {
      const { getNodeVersion } = await import('../../../../src/utils/system.js');

      vi.mocked(getNodeVersion).mockReturnValue({ major: 20, minor: 0, patch: 0 });

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
      };

      const results = await runPreflight(config);

      const nodeCheck = results.find((r) => r.name === 'node_version');
      expect(nodeCheck?.duration).toBeGreaterThanOrEqual(0);
      expect(typeof nodeCheck?.duration).toBe('number');
    });

    it('should handle check failures', async () => {
      const { getNodeVersion } = await import('../../../../src/utils/system.js');

      vi.mocked(getNodeVersion).mockReturnValue({ major: 16, minor: 0, patch: 0 }); // Old version

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
      };

      const results = await runPreflight(config);

      const nodeCheck = results.find((r) => r.name === 'node_version');
      expect(nodeCheck?.passed).toBe(false);
      expect(nodeCheck?.error).toBeDefined();
      expect(nodeCheck?.fixSuggestion).toBeDefined();
    });

    it('should skip conditional checks that do not apply', async () => {
      // Reset modules to ensure mocks are applied fresh
      vi.resetModules();

      // Re-import with mocks applied
      const { getNodeVersion, isDockerRunning } = await import('../../../../src/utils/system.js');
      const { hasDockerProcesses } = await import('../../../../src/core/config/parser.js');
      const { runPreflight: runPreflightFresh } = await import('../../../../src/core/preflight/runner.js');

      vi.mocked(getNodeVersion).mockReturnValue({ major: 20, minor: 0, patch: 0 });
      vi.mocked(hasDockerProcesses).mockReturnValue(false);

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
      };

      const results = await runPreflightFresh(config);

      // Docker check should not run because no docker processes in config
      const dockerCheck = results.find((r) => r.name === 'docker_daemon');
      expect(dockerCheck).toBeUndefined();
      expect(isDockerRunning).not.toHaveBeenCalled();
    });

    it('should handle multiple custom checks', async () => {
      const { getNodeVersion } = await import('../../../../src/utils/system.js');
      const { execa } = await import('execa');

      vi.mocked(getNodeVersion).mockReturnValue({ major: 20, minor: 0, patch: 0 });
      vi.mocked(execa)
        .mockResolvedValueOnce({ exitCode: 0 } as any)
        .mockResolvedValueOnce({ exitCode: 0 } as any);

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
        preflight: {
          checks: [
            {
              name: 'check_1',
              command: 'test -f file1',
              error: 'File 1 not found',
            },
            {
              name: 'check_2',
              command: 'test -f file2',
              error: 'File 2 not found',
            },
          ],
        },
      };

      const results = await runPreflight(config);

      const customChecks = results.filter((r) => r.name.startsWith('check_'));
      expect(customChecks).toHaveLength(2);
      expect(customChecks.every((c) => c.passed)).toBe(true);
    });

    it('should handle port check with multiple ports', async () => {
      const { getNodeVersion } = await import('../../../../src/utils/system.js');
      const { extractPorts } = await import('../../../../src/core/config/parser.js');
      const { checkPorts } = await import('../../../../src/utils/port.js');

      vi.mocked(getNodeVersion).mockReturnValue({ major: 20, minor: 0, patch: 0 });
      vi.mocked(extractPorts).mockReturnValue([3000, 8080]);
      vi.mocked(checkPorts).mockResolvedValue([]);

      const config: OrckitConfig = {
        processes: {
          api: {
            category: 'backend',
            command: 'npm start',
            ready: { type: 'tcp', host: 'localhost', port: 3000 },
          },
          web: {
            category: 'frontend',
            command: 'npm run dev',
            ready: { type: 'http', url: 'http://localhost:8080' },
          },
        },
      };

      const results = await runPreflight(config);

      const portCheck = results.find((r) => r.name === 'port_availability');
      expect(portCheck).toBeDefined();
      expect(checkPorts).toHaveBeenCalledWith([3000, 8080]);
    });

    it('should return all check results in order', async () => {
      const { getNodeVersion } = await import('../../../../src/utils/system.js');
      const { execa } = await import('execa');

      vi.mocked(getNodeVersion).mockReturnValue({ major: 20, minor: 0, patch: 0 });
      vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as any);

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
        preflight: {
          checks: [
            {
              name: 'custom_check',
              command: 'test -f package.json',
              error: 'package.json not found',
            },
          ],
        },
      };

      const results = await runPreflight(config);

      // Should have results for all checks
      expect(results.length).toBeGreaterThan(0);
      results.forEach((result) => {
        expect(result).toHaveProperty('name');
        expect(result).toHaveProperty('passed');
        expect(result).toHaveProperty('duration');
      });
    });

    it('should include error and fix suggestion for failed checks', async () => {
      const { getNodeVersion } = await import('../../../../src/utils/system.js');

      vi.mocked(getNodeVersion).mockReturnValue({ major: 16, minor: 0, patch: 0 }); // Old Node version

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
      };

      const results = await runPreflight(config);

      const failedChecks = results.filter((r) => !r.passed);
      expect(failedChecks.length).toBeGreaterThan(0);

      failedChecks.forEach((check) => {
        expect(check.error).toBeDefined();
        expect(typeof check.error).toBe('string');
      });
    });

    it('should handle empty config', async () => {
      const { getNodeVersion } = await import('../../../../src/utils/system.js');

      vi.mocked(getNodeVersion).mockReturnValue({ major: 20, minor: 0, patch: 0 });

      const config: OrckitConfig = {
        processes: {},
      };

      const results = await runPreflight(config);

      // Should still run built-in checks
      expect(results.length).toBeGreaterThan(0);
      const checkNames = results.map((r) => r.name);
      expect(checkNames).toContain('node_version');
      expect(checkNames).toContain('port_availability');
    });
  });
});
