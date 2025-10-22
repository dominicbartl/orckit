import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPreflight } from '../../../../src/core/preflight/runner.js';
import type { OrckitConfig } from '../../../../src/types/index.js';

// Mock system utilities
vi.mock('../../../../src/utils/system.js', () => ({
  isDockerRunning: vi.fn(),
  isTmuxAvailable: vi.fn(),
  getNodeVersion: vi.fn(),
  isPortAvailable: vi.fn(),
}));

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

describe('Preflight Runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runPreflight', () => {
    it('should run all built-in checks by default', async () => {
      const { isTmuxAvailable, getNodeVersion } = await import('../../../../src/utils/system.js');

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockResolvedValue('20.0.0');

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
      };

      const results = await runPreflight(config);

      // Should include tmux and node_version checks (docker skipped)
      const checkNames = results.map((r) => r.name);
      expect(checkNames).toContain('tmux');
      expect(checkNames).toContain('node_version');
      expect(checkNames).not.toContain('docker_daemon'); // Conditional check skipped
    });

    it('should include docker check when config has docker processes', async () => {
      const { isTmuxAvailable, getNodeVersion, isDockerRunning } = await import(
        '../../../../src/utils/system.js'
      );

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockResolvedValue('20.0.0');
      vi.mocked(isDockerRunning).mockResolvedValue(true);

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
      const { isTmuxAvailable, getNodeVersion, isPortAvailable } = await import(
        '../../../../src/utils/system.js'
      );

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockResolvedValue('20.0.0');
      vi.mocked(isPortAvailable).mockResolvedValue(true);

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
      expect(isPortAvailable).toHaveBeenCalledWith(3000);
    });

    it('should include custom checks from config', async () => {
      const { isTmuxAvailable, getNodeVersion } = await import('../../../../src/utils/system.js');
      const { execa } = await import('execa');

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockResolvedValue('20.0.0');
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
      const { isTmuxAvailable, getNodeVersion } = await import('../../../../src/utils/system.js');

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve('20.0.0'), 50))
      );

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
      const { isTmuxAvailable, getNodeVersion } = await import('../../../../src/utils/system.js');

      vi.mocked(isTmuxAvailable).mockResolvedValue(false);
      vi.mocked(getNodeVersion).mockResolvedValue('20.0.0');

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
      };

      const results = await runPreflight(config);

      const tmuxCheck = results.find((r) => r.name === 'tmux');
      expect(tmuxCheck?.passed).toBe(false);
      expect(tmuxCheck?.error).toContain('tmux');
      expect(tmuxCheck?.fixSuggestion).toBeDefined();
    });

    it('should handle check exceptions', async () => {
      const { isTmuxAvailable, getNodeVersion } = await import('../../../../src/utils/system.js');

      vi.mocked(isTmuxAvailable).mockRejectedValue(new Error('System error'));
      vi.mocked(getNodeVersion).mockResolvedValue('20.0.0');

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
      };

      const results = await runPreflight(config);

      const tmuxCheck = results.find((r) => r.name === 'tmux');
      expect(tmuxCheck?.passed).toBe(false);
      expect(tmuxCheck?.error).toBeDefined();
    });

    it('should skip conditional checks that do not apply', async () => {
      const { isTmuxAvailable, getNodeVersion, isDockerRunning } = await import(
        '../../../../src/utils/system.js'
      );

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockResolvedValue('20.0.0');

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
      };

      const results = await runPreflight(config);

      // Docker check should not run because no docker processes in config
      const dockerCheck = results.find((r) => r.name === 'docker_daemon');
      expect(dockerCheck).toBeUndefined();
      expect(isDockerRunning).not.toHaveBeenCalled();
    });

    it('should handle multiple custom checks', async () => {
      const { isTmuxAvailable, getNodeVersion } = await import('../../../../src/utils/system.js');
      const { execa } = await import('execa');

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockResolvedValue('20.0.0');
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
      const { isTmuxAvailable, getNodeVersion, isPortAvailable } = await import(
        '../../../../src/utils/system.js'
      );

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockResolvedValue('20.0.0');
      vi.mocked(isPortAvailable).mockResolvedValue(true);

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
      expect(isPortAvailable).toHaveBeenCalledWith(3000);
      expect(isPortAvailable).toHaveBeenCalledWith(8080);
    });

    it('should return all check results in order', async () => {
      const { isTmuxAvailable, getNodeVersion } = await import('../../../../src/utils/system.js');
      const { execa } = await import('execa');

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockResolvedValue('20.0.0');
      vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as any);

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start', port: 3000 },
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
      const { isTmuxAvailable, getNodeVersion } = await import('../../../../src/utils/system.js');

      vi.mocked(isTmuxAvailable).mockResolvedValue(false);
      vi.mocked(getNodeVersion).mockResolvedValue('16.0.0'); // Old Node version

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
      const { isTmuxAvailable, getNodeVersion } = await import('../../../../src/utils/system.js');

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockResolvedValue('20.0.0');

      const config: OrckitConfig = {
        processes: {},
      };

      const results = await runPreflight(config);

      // Should still run built-in checks
      expect(results.length).toBeGreaterThan(0);
      const checkNames = results.map((r) => r.name);
      expect(checkNames).toContain('tmux');
      expect(checkNames).toContain('node_version');
    });
  });
});
