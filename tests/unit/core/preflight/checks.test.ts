import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BUILTIN_CHECKS,
  createPortCheck,
  createCustomCheck,
  runPreflightChecks,
  allChecksPassed,
  getFailedChecks,
} from '../../../../src/core/preflight/checks.js';
import type { OrckitConfig, PreflightCheckResult } from '../../../../src/types/index.js';

// Mock system utils
vi.mock('../../../../src/utils/system.js', () => ({
  isDockerRunning: vi.fn(),
  isTmuxAvailable: vi.fn(),
  getNodeVersion: vi.fn(),
  isPortAvailable: vi.fn(),
}));

// Mock config parser
vi.mock('../../../../src/core/config/parser.js', () => ({
  extractPorts: vi.fn(),
  hasDockerProcesses: vi.fn(),
}));

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

describe('Preflight Checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('BUILTIN_CHECKS', () => {
    it('should have tmux check', () => {
      const tmuxCheck = BUILTIN_CHECKS.find((c) => c.name === 'tmux');
      expect(tmuxCheck).toBeDefined();
      expect(tmuxCheck?.errorMessage).toContain('tmux');
      expect(tmuxCheck?.fixSuggestion).toContain('brew install');
    });

    it('should have docker_daemon check', () => {
      const dockerCheck = BUILTIN_CHECKS.find((c) => c.name === 'docker_daemon');
      expect(dockerCheck).toBeDefined();
      expect(dockerCheck?.errorMessage).toContain('Docker');
      expect(dockerCheck?.fixSuggestion).toBeDefined();
      expect(dockerCheck?.conditional).toBeDefined();
    });

    it('should have node_version check', () => {
      const nodeCheck = BUILTIN_CHECKS.find((c) => c.name === 'node_version');
      expect(nodeCheck).toBeDefined();
      expect(nodeCheck?.errorMessage).toContain('Node.js');
      expect(nodeCheck?.fixSuggestion).toContain('nodejs.org');
    });

    it('should have exactly 3 built-in checks', () => {
      expect(BUILTIN_CHECKS).toHaveLength(3);
    });

    describe('tmux check execution', () => {
      it('should pass when tmux is available', async () => {
        const { isTmuxAvailable } = await import('../../../../src/utils/system.js');
        vi.mocked(isTmuxAvailable).mockResolvedValue(true);

        const tmuxCheck = BUILTIN_CHECKS.find((c) => c.name === 'tmux')!;
        const result = await tmuxCheck.check();

        expect(result).toBe(true);
      });

      it('should fail when tmux is not available', async () => {
        const { isTmuxAvailable } = await import('../../../../src/utils/system.js');
        vi.mocked(isTmuxAvailable).mockResolvedValue(false);

        const tmuxCheck = BUILTIN_CHECKS.find((c) => c.name === 'tmux')!;
        const result = await tmuxCheck.check();

        expect(result).toBe(false);
      });
    });

    describe('docker_daemon check execution', () => {
      it('should pass when docker is running', async () => {
        const { isDockerRunning } = await import('../../../../src/utils/system.js');
        vi.mocked(isDockerRunning).mockResolvedValue(true);

        const dockerCheck = BUILTIN_CHECKS.find((c) => c.name === 'docker_daemon')!;
        const result = await dockerCheck.check();

        expect(result).toBe(true);
      });

      it('should fail when docker is not running', async () => {
        const { isDockerRunning } = await import('../../../../src/utils/system.js');
        vi.mocked(isDockerRunning).mockResolvedValue(false);

        const dockerCheck = BUILTIN_CHECKS.find((c) => c.name === 'docker_daemon')!;
        const result = await dockerCheck.check();

        expect(result).toBe(false);
      });

      it('should be conditional based on config', async () => {
        const { hasDockerProcesses } = await import('../../../../src/core/config/parser.js');
        vi.mocked(hasDockerProcesses).mockReturnValue(true);

        const dockerCheck = BUILTIN_CHECKS.find((c) => c.name === 'docker_daemon')!;
        const config: OrckitConfig = {
          processes: {
            db: { category: 'infra', type: 'docker', command: 'docker run postgres' },
          },
        };

        expect(dockerCheck.conditional!(config)).toBe(true);
      });

      it('should not run if no docker processes', async () => {
        const { hasDockerProcesses } = await import('../../../../src/core/config/parser.js');
        vi.mocked(hasDockerProcesses).mockReturnValue(false);

        const dockerCheck = BUILTIN_CHECKS.find((c) => c.name === 'docker_daemon')!;
        const config: OrckitConfig = {
          processes: {
            api: { category: 'backend', command: 'npm start' },
          },
        };

        expect(dockerCheck.conditional!(config)).toBe(false);
      });
    });

    describe('node_version check execution', () => {
      it('should pass for Node 18+', async () => {
        const { getNodeVersion } = await import('../../../../src/utils/system.js');
        vi.mocked(getNodeVersion).mockReturnValue({ major: 18, minor: 0, patch: 0 });

        const nodeCheck = BUILTIN_CHECKS.find((c) => c.name === 'node_version')!;
        const result = await nodeCheck.check();

        expect(result).toBe(true);
      });

      it('should pass for Node 20+', async () => {
        const { getNodeVersion } = await import('../../../../src/utils/system.js');
        vi.mocked(getNodeVersion).mockReturnValue({ major: 20, minor: 10, patch: 0 });

        const nodeCheck = BUILTIN_CHECKS.find((c) => c.name === 'node_version')!;
        const result = await nodeCheck.check();

        expect(result).toBe(true);
      });

      it('should fail for Node 16', async () => {
        const { getNodeVersion } = await import('../../../../src/utils/system.js');
        vi.mocked(getNodeVersion).mockReturnValue({ major: 16, minor: 20, patch: 0 });

        const nodeCheck = BUILTIN_CHECKS.find((c) => c.name === 'node_version')!;
        const result = await nodeCheck.check();

        expect(result).toBe(false);
      });

      it('should fail for Node 14', async () => {
        const { getNodeVersion } = await import('../../../../src/utils/system.js');
        vi.mocked(getNodeVersion).mockReturnValue({ major: 14, minor: 0, patch: 0 });

        const nodeCheck = BUILTIN_CHECKS.find((c) => c.name === 'node_version')!;
        const result = await nodeCheck.check();

        expect(result).toBe(false);
      });
    });
  });

  describe('createPortCheck', () => {
    it('should create port availability check', async () => {
      const { extractPorts } = await import('../../../../src/core/config/parser.js');
      const { isPortAvailable } = await import('../../../../src/utils/system.js');

      vi.mocked(extractPorts).mockReturnValue([3000, 5432]);
      vi.mocked(isPortAvailable).mockResolvedValue(true);

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
      };

      const portCheck = createPortCheck(config);

      expect(portCheck.name).toBe('port_availability');
      expect(portCheck.errorMessage).toContain('ports');

      const result = await portCheck.check();
      expect(result).toBe(true);
      expect(isPortAvailable).toHaveBeenCalledWith(3000);
      expect(isPortAvailable).toHaveBeenCalledWith(5432);
    });

    it('should fail if any port is in use', async () => {
      const { extractPorts } = await import('../../../../src/core/config/parser.js');
      const { isPortAvailable } = await import('../../../../src/utils/system.js');

      vi.mocked(extractPorts).mockReturnValue([3000, 5432]);
      vi.mocked(isPortAvailable)
        .mockResolvedValueOnce(true) // 3000 available
        .mockResolvedValueOnce(false); // 5432 in use

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
      };

      const portCheck = createPortCheck(config);
      const result = await portCheck.check();

      expect(result).toBe(false);
    });

    it('should pass if no ports to check', async () => {
      const { extractPorts } = await import('../../../../src/core/config/parser.js');

      vi.mocked(extractPorts).mockReturnValue([]);

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
      };

      const portCheck = createPortCheck(config);
      const result = await portCheck.check();

      expect(result).toBe(true);
    });

    it('should have fix suggestion', () => {
      const config: OrckitConfig = {
        processes: {},
      };

      const portCheck = createPortCheck(config);
      expect(portCheck.fixSuggestion).toBeDefined();
      expect(portCheck.fixSuggestion).toContain('Stop');
    });
  });

  describe('createCustomCheck', () => {
    it('should create custom check', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as any);

      const check = createCustomCheck('my-check', 'test -f /tmp/file', 'File not found', 'Create the file');

      expect(check.name).toBe('my-check');
      expect(check.errorMessage).toBe('File not found');
      expect(check.fixSuggestion).toBe('Create the file');

      const result = await check.check();
      expect(result).toBe(true);
      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', 'test -f /tmp/file'],
        expect.objectContaining({ timeout: 10000 })
      );
    });

    it('should fail when command exits non-zero', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({ exitCode: 1 } as any);

      const check = createCustomCheck('check', 'false', 'Failed');
      const result = await check.check();

      expect(result).toBe(false);
    });

    it('should fail when command throws error', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValue(new Error('Command failed'));

      const check = createCustomCheck('check', 'invalid', 'Failed');
      const result = await check.check();

      expect(result).toBe(false);
    });

    it('should handle check without fix suggestion', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as any);

      const check = createCustomCheck('check', 'echo test', 'Error');

      expect(check.fixSuggestion).toBeUndefined();
    });
  });

  describe('runPreflightChecks', () => {
    it('should run all applicable checks', async () => {
      const { isTmuxAvailable, isDockerRunning, getNodeVersion, isPortAvailable } = await import(
        '../../../../src/utils/system.js'
      );
      const { extractPorts, hasDockerProcesses } = await import('../../../../src/core/config/parser.js');

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(isDockerRunning).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockReturnValue({ major: 18, minor: 0, patch: 0 });
      vi.mocked(extractPorts).mockReturnValue([3000]);
      vi.mocked(isPortAvailable).mockResolvedValue(true);
      vi.mocked(hasDockerProcesses).mockReturnValue(false);

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
      };

      const results = await runPreflightChecks(config);

      // Should have tmux, node_version, and port checks (docker skipped)
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.passed)).toBe(true);
    });

    it('should include docker check when config has docker processes', async () => {
      const { isTmuxAvailable, isDockerRunning, getNodeVersion, isPortAvailable } = await import(
        '../../../../src/utils/system.js'
      );
      const { extractPorts, hasDockerProcesses } = await import('../../../../src/core/config/parser.js');

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(isDockerRunning).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockReturnValue({ major: 20, minor: 0, patch: 0 });
      vi.mocked(extractPorts).mockReturnValue([]);
      vi.mocked(isPortAvailable).mockResolvedValue(true);
      vi.mocked(hasDockerProcesses).mockReturnValue(true);

      const config: OrckitConfig = {
        processes: {
          db: { category: 'infra', type: 'docker', command: 'docker run postgres' },
        },
      };

      const results = await runPreflightChecks(config);

      // Should have all 4 checks: tmux, docker, node_version, port
      expect(results).toHaveLength(4);
      expect(results.find((r) => r.name === 'docker_daemon')).toBeDefined();
    });

    it('should include custom checks from config', async () => {
      const { isTmuxAvailable, getNodeVersion, isPortAvailable } = await import('../../../../src/utils/system.js');
      const { extractPorts, hasDockerProcesses } = await import('../../../../src/core/config/parser.js');
      const { execa } = await import('execa');

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockReturnValue({ major: 18, minor: 0, patch: 0 });
      vi.mocked(extractPorts).mockReturnValue([]);
      vi.mocked(isPortAvailable).mockResolvedValue(true);
      vi.mocked(hasDockerProcesses).mockReturnValue(false);
      vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as any);

      const config: OrckitConfig = {
        processes: {
          api: { category: 'backend', command: 'npm start' },
        },
        preflight: {
          checks: [
            {
              name: 'custom-check',
              command: 'echo test',
              error: 'Custom check failed',
            },
          ],
        },
      };

      const results = await runPreflightChecks(config);

      expect(results.length).toBeGreaterThan(3);
      expect(results.find((r) => r.name === 'custom-check')).toBeDefined();
    });

    it('should call onCheckStart callback', async () => {
      const { isTmuxAvailable, getNodeVersion, isPortAvailable } = await import('../../../../src/utils/system.js');
      const { extractPorts, hasDockerProcesses } = await import('../../../../src/core/config/parser.js');

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockReturnValue({ major: 18, minor: 0, patch: 0 });
      vi.mocked(extractPorts).mockReturnValue([]);
      vi.mocked(isPortAvailable).mockResolvedValue(true);
      vi.mocked(hasDockerProcesses).mockReturnValue(false);

      const config: OrckitConfig = {
        processes: {},
      };

      const onCheckStart = vi.fn();
      await runPreflightChecks(config, onCheckStart);

      expect(onCheckStart).toHaveBeenCalled();
      expect(onCheckStart).toHaveBeenCalledWith('tmux');
      expect(onCheckStart).toHaveBeenCalledWith('node_version');
      expect(onCheckStart).toHaveBeenCalledWith('port_availability');
    });

    it('should call onCheckComplete callback', async () => {
      const { isTmuxAvailable, getNodeVersion, isPortAvailable } = await import('../../../../src/utils/system.js');
      const { extractPorts, hasDockerProcesses } = await import('../../../../src/core/config/parser.js');

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockReturnValue({ major: 18, minor: 0, patch: 0 });
      vi.mocked(extractPorts).mockReturnValue([]);
      vi.mocked(isPortAvailable).mockResolvedValue(true);
      vi.mocked(hasDockerProcesses).mockReturnValue(false);

      const config: OrckitConfig = {
        processes: {},
      };

      const onCheckComplete = vi.fn();
      await runPreflightChecks(config, undefined, onCheckComplete);

      expect(onCheckComplete).toHaveBeenCalled();
      expect(onCheckComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.any(String),
          passed: expect.any(Boolean),
          duration: expect.any(Number),
        })
      );
    });

    it('should include error and fixSuggestion for failed checks', async () => {
      const { isTmuxAvailable, getNodeVersion, isPortAvailable } = await import('../../../../src/utils/system.js');
      const { extractPorts, hasDockerProcesses } = await import('../../../../src/core/config/parser.js');

      vi.mocked(isTmuxAvailable).mockResolvedValue(false);
      vi.mocked(getNodeVersion).mockReturnValue({ major: 18, minor: 0, patch: 0 });
      vi.mocked(extractPorts).mockReturnValue([]);
      vi.mocked(isPortAvailable).mockResolvedValue(true);
      vi.mocked(hasDockerProcesses).mockReturnValue(false);

      const config: OrckitConfig = {
        processes: {},
      };

      const results = await runPreflightChecks(config);
      const tmuxResult = results.find((r) => r.name === 'tmux')!;

      expect(tmuxResult.passed).toBe(false);
      expect(tmuxResult.error).toBeDefined();
      expect(tmuxResult.fixSuggestion).toBeDefined();
    });

    it('should measure check duration', async () => {
      const { isTmuxAvailable, getNodeVersion, isPortAvailable } = await import('../../../../src/utils/system.js');
      const { extractPorts, hasDockerProcesses } = await import('../../../../src/core/config/parser.js');

      vi.mocked(isTmuxAvailable).mockResolvedValue(true);
      vi.mocked(getNodeVersion).mockReturnValue({ major: 18, minor: 0, patch: 0 });
      vi.mocked(extractPorts).mockReturnValue([]);
      vi.mocked(isPortAvailable).mockResolvedValue(true);
      vi.mocked(hasDockerProcesses).mockReturnValue(false);

      const config: OrckitConfig = {
        processes: {},
      };

      const results = await runPreflightChecks(config);

      results.forEach((result) => {
        expect(result.duration).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('allChecksPassed', () => {
    it('should return true when all checks pass', () => {
      const results: PreflightCheckResult[] = [
        { name: 'check1', passed: true, duration: 10 },
        { name: 'check2', passed: true, duration: 20 },
        { name: 'check3', passed: true, duration: 15 },
      ];

      expect(allChecksPassed(results)).toBe(true);
    });

    it('should return false when any check fails', () => {
      const results: PreflightCheckResult[] = [
        { name: 'check1', passed: true, duration: 10 },
        { name: 'check2', passed: false, duration: 20, error: 'Failed' },
        { name: 'check3', passed: true, duration: 15 },
      ];

      expect(allChecksPassed(results)).toBe(false);
    });

    it('should return true for empty array', () => {
      expect(allChecksPassed([])).toBe(true);
    });
  });

  describe('getFailedChecks', () => {
    it('should return only failed checks', () => {
      const results: PreflightCheckResult[] = [
        { name: 'check1', passed: true, duration: 10 },
        { name: 'check2', passed: false, duration: 20, error: 'Failed' },
        { name: 'check3', passed: true, duration: 15 },
        { name: 'check4', passed: false, duration: 25, error: 'Also failed' },
      ];

      const failed = getFailedChecks(results);

      expect(failed).toHaveLength(2);
      expect(failed[0].name).toBe('check2');
      expect(failed[1].name).toBe('check4');
    });

    it('should return empty array when all pass', () => {
      const results: PreflightCheckResult[] = [
        { name: 'check1', passed: true, duration: 10 },
        { name: 'check2', passed: true, duration: 20 },
      ];

      const failed = getFailedChecks(results);

      expect(failed).toHaveLength(0);
    });

    it('should return empty array for empty input', () => {
      expect(getFailedChecks([])).toHaveLength(0);
    });
  });
});
