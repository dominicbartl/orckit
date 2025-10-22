import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BootLogger } from '../../../../src/core/boot/logger.js';
import type { PreflightCheckResult } from '../../../../src/types/index.js';

describe('BootLogger', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleClearSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleClearSpy = vi.spyOn(console, 'clear').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleClearSpy.mockRestore();
  });

  describe('constructor', () => {
    it('should create with default timeline style', () => {
      const logger = new BootLogger();
      expect(logger).toBeDefined();
    });

    it('should create with quiet style', () => {
      const logger = new BootLogger('quiet');
      expect(logger).toBeDefined();
    });

    it('should create with minimal style', () => {
      const logger = new BootLogger('minimal');
      expect(logger).toBeDefined();
    });

    it('should create with dashboard style', () => {
      const logger = new BootLogger('dashboard');
      expect(logger).toBeDefined();
    });
  });

  describe('printHeader', () => {
    it('should print header with project name', () => {
      const logger = new BootLogger('timeline');
      logger.printHeader('test-project');

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('MAESTRO');
      expect(output).toContain('test-project');
    });

    it('should print header without project name', () => {
      const logger = new BootLogger('timeline');
      logger.printHeader();

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('MAESTRO');
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      logger.printHeader('test-project');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printPreflightStart', () => {
    it('should print preflight header', () => {
      const logger = new BootLogger('timeline');
      logger.printPreflightStart();

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('Pre-flight Checks');
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      logger.printPreflightStart();

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printPreflightCheck', () => {
    it('should print passed check', () => {
      const logger = new BootLogger('timeline');
      const result: PreflightCheckResult = {
        name: 'tmux',
        passed: true,
        duration: 10,
      };

      logger.printPreflightCheck(result);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('tmux');
    });

    it('should print failed check with fix suggestion', () => {
      const logger = new BootLogger('timeline');
      const result: PreflightCheckResult = {
        name: 'docker',
        passed: false,
        duration: 5,
        fixSuggestion: 'Install Docker Desktop',
      };

      logger.printPreflightCheck(result);

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      const output1 = consoleLogSpy.mock.calls[0][0];
      const output2 = consoleLogSpy.mock.calls[1][0];
      expect(output1).toContain('docker');
      expect(output2).toContain('Install Docker Desktop');
    });

    it('should print failed check without fix suggestion', () => {
      const logger = new BootLogger('timeline');
      const result: PreflightCheckResult = {
        name: 'docker',
        passed: false,
        duration: 5,
      };

      logger.printPreflightCheck(result);

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      const result: PreflightCheckResult = {
        name: 'tmux',
        passed: true,
        duration: 10,
      };

      logger.printPreflightCheck(result);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printDependencyGraph', () => {
    it('should print dependency graph', () => {
      const logger = new BootLogger('timeline');
      logger.printDependencyGraph('api\n  └─ db\nweb\n  └─ api', 3);

      expect(consoleLogSpy).toHaveBeenCalled();
      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(allOutput).toContain('Dependency Graph');
      expect(allOutput).toContain('api');
      expect(allOutput).toContain('3 processes');
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      logger.printDependencyGraph('api\n  └─ db', 2);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printProcessesStart', () => {
    it('should print processes start header', () => {
      const logger = new BootLogger('timeline');
      logger.printProcessesStart(3);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('Starting Processes');
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      logger.printProcessesStart(3);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printProcessStarting', () => {
    it('should print process starting in timeline mode', () => {
      const logger = new BootLogger('timeline');
      logger.printProcessesStart(3);
      consoleLogSpy.mockClear();

      logger.printProcessStarting('api', 0, 'backend');

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('[1/3]');
      expect(output).toContain('api');
      expect(output).toContain('backend');
    });

    it('should print process starting in minimal mode', () => {
      const logger = new BootLogger('minimal');
      logger.printProcessesStart(3);
      consoleLogSpy.mockClear();

      logger.printProcessStarting('api', 0, 'backend');

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('api');
      expect(output).toContain('starting');
    });

    it('should track progress correctly', () => {
      const logger = new BootLogger('timeline');
      logger.printProcessesStart(3);
      consoleLogSpy.mockClear();

      logger.printProcessStarting('api', 0, 'backend');
      logger.printProcessStarting('web', 1, 'frontend');

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      expect(consoleLogSpy.mock.calls[0][0]).toContain('[1/3]');
      expect(consoleLogSpy.mock.calls[1][0]).toContain('[2/3]');
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      logger.printProcessStarting('api', 0, 'backend');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printHook', () => {
    it('should print hook in timeline mode', () => {
      const logger = new BootLogger('timeline');
      logger.printHook('post-start', 'npm run setup');

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('post-start');
      expect(output).toContain('npm run setup');
    });

    it('should truncate long commands', () => {
      const logger = new BootLogger('timeline');
      const longCommand = 'npm run ' + 'a'.repeat(100);
      logger.printHook('post-start', longCommand);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output.length).toBeLessThan(longCommand.length + 50);
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      logger.printHook('post-start', 'npm run setup');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should not print in minimal mode', () => {
      const logger = new BootLogger('minimal');
      logger.printHook('post-start', 'npm run setup');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printHookComplete', () => {
    it('should print hook complete in timeline mode', () => {
      const logger = new BootLogger('timeline');
      logger.printHookComplete('post-start', 150);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('post-start');
      expect(output).toContain('complete');
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      logger.printHookComplete('post-start', 150);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should not print in minimal mode', () => {
      const logger = new BootLogger('minimal');
      logger.printHookComplete('post-start', 150);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printProcessStatus', () => {
    it('should print status in timeline mode', () => {
      const logger = new BootLogger('timeline');
      logger.printProcessStatus('api', 'Compiling TypeScript');

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('Compiling TypeScript');
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      logger.printProcessStatus('api', 'Compiling');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printHealthCheckAttempt', () => {
    it('should print health check in timeline mode', () => {
      const logger = new BootLogger('timeline');
      logger.printHealthCheckAttempt('api', 1, 'Checking http://localhost:3000');

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('Attempt 1');
      expect(output).toContain('Checking http://localhost:3000');
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      logger.printHealthCheckAttempt('api', 1, 'Checking');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printBuildProgress', () => {
    it('should print build progress in timeline mode', () => {
      const logger = new BootLogger('timeline');
      logger.printBuildProgress('web', 50);

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('Progress');
      expect(output).toContain('50%');
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      logger.printBuildProgress('web', 50);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printProcessReady', () => {
    it('should print ready in timeline mode with duration and info', () => {
      const logger = new BootLogger('timeline');
      logger.printProcessReady('api', 2500, 'http://localhost:3000');

      expect(consoleLogSpy).toHaveBeenCalledTimes(2); // Status line + blank line
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('Ready');
      expect(output).toContain('http://localhost:3000');
    });

    it('should print ready in timeline mode without info', () => {
      const logger = new BootLogger('timeline');
      logger.printProcessReady('api', 2500);

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('Ready');
    });

    it('should print ready in timeline mode without duration', () => {
      const logger = new BootLogger('timeline');
      logger.printProcessReady('api');

      expect(consoleLogSpy).toHaveBeenCalledTimes(2);
    });

    it('should print ready in minimal mode', () => {
      const logger = new BootLogger('minimal');
      logger.printProcessReady('api', 2500);

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('api');
      expect(output).toContain('ready');
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      logger.printProcessReady('api', 2500);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printProcessFailed', () => {
    it('should print failure message', () => {
      const logger = new BootLogger('timeline');
      logger.printProcessFailed('api', 'Port 3000 already in use');

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('Failed');
      expect(output).toContain('Port 3000 already in use');
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      logger.printProcessFailed('api', 'Error');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printCompletionSummary', () => {
    it('should print success summary', () => {
      const logger = new BootLogger('timeline');
      logger.printCompletionSummary(3, 0);

      expect(consoleLogSpy).toHaveBeenCalled();
      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(allOutput).toContain('All processes started successfully');
    });

    it('should print summary with failures', () => {
      const logger = new BootLogger('timeline');
      logger.printCompletionSummary(2, 1);

      expect(consoleLogSpy).toHaveBeenCalled();
      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(allOutput).toContain('2 succeeded, 1 failed');
    });

    it('should print summary with URLs', () => {
      const logger = new BootLogger('timeline');
      logger.printCompletionSummary(3, 0, [
        'http://localhost:3000',
        'http://localhost:5173',
      ]);

      expect(consoleLogSpy).toHaveBeenCalled();
      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(allOutput).toContain('Quick Links');
      expect(allOutput).toContain('http://localhost:3000');
      expect(allOutput).toContain('http://localhost:5173');
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      logger.printCompletionSummary(3, 0);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printDashboard', () => {
    it('should print dashboard in dashboard mode', () => {
      const logger = new BootLogger('dashboard');
      const preflightResults: PreflightCheckResult[] = [
        { name: 'tmux', passed: true, duration: 10 },
        { name: 'docker', passed: true, duration: 15 },
      ];
      const processStatuses = new Map([
        ['api', 'running'],
        ['web', 'building'],
      ]);

      logger.printDashboard(preflightResults, processStatuses);

      expect(consoleClearSpy).toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalled();
      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(allOutput).toContain('MAESTRO');
      expect(allOutput).toContain('Pre-flight');
      expect(allOutput).toContain('2/2 checks passed');
      expect(allOutput).toContain('Process Status');
      expect(allOutput).toContain('api');
      expect(allOutput).toContain('running');
    });

    it('should show failed process icon', () => {
      const logger = new BootLogger('dashboard');
      const preflightResults: PreflightCheckResult[] = [];
      const processStatuses = new Map([['api', 'failed']]);

      logger.printDashboard(preflightResults, processStatuses);

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should show building process icon', () => {
      const logger = new BootLogger('dashboard');
      const preflightResults: PreflightCheckResult[] = [];
      const processStatuses = new Map([['web', 'building']]);

      logger.printDashboard(preflightResults, processStatuses);

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should not print in non-dashboard mode', () => {
      const logger = new BootLogger('timeline');
      const preflightResults: PreflightCheckResult[] = [];
      const processStatuses = new Map();

      logger.printDashboard(preflightResults, processStatuses);

      expect(consoleClearSpy).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printPhaseHeader', () => {
    it('should print phase header', () => {
      const logger = new BootLogger('timeline');
      logger.printPhaseHeader('Configuration');

      expect(consoleLogSpy).toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls[0][0];
      expect(output).toContain('Configuration');
    });

    it('should handle long phase names', () => {
      const logger = new BootLogger('timeline');
      logger.printPhaseHeader('Very Long Phase Name That Exceeds Normal Length');

      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      logger.printPhaseHeader('Configuration');

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });

  describe('printCompletion', () => {
    it('should print completion message', () => {
      const logger = new BootLogger('timeline');
      logger.printCompletion(5);

      expect(consoleLogSpy).toHaveBeenCalled();
      const allOutput = consoleLogSpy.mock.calls.map((call) => call[0]).join('\n');
      expect(allOutput).toContain('All 5 processes started successfully');
      expect(allOutput).toContain('Total time');
    });

    it('should not print in quiet mode', () => {
      const logger = new BootLogger('quiet');
      logger.printCompletion(5);

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });
});
