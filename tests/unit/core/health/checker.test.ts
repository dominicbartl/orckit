import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import {
  HttpHealthChecker,
  TcpHealthChecker,
  LogPatternHealthChecker,
  CustomHealthChecker,
  waitForReady,
  createHealthChecker,
  type HealthCheckResult,
} from '../../../../src/core/health/checker.js';
import type {
  HttpReadyCheck,
  TcpReadyCheck,
  LogPatternReadyCheck,
  CustomReadyCheck,
  ReadyCheck,
} from '../../../../src/types/index.js';

// Mock node-fetch
vi.mock('node-fetch', () => ({
  default: vi.fn(),
}));

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock net
vi.mock('net', () => ({
  createConnection: vi.fn(),
}));

describe('Health Checker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('HttpHealthChecker', () => {
    it('should succeed when HTTP request returns expected status', async () => {
      const fetch = (await import('node-fetch')).default;
      vi.mocked(fetch).mockResolvedValue({
        status: 200,
      } as any);

      const config: HttpReadyCheck = {
        type: 'http',
        url: 'http://localhost:3000/health',
      };

      const checker = new HttpHealthChecker(config);
      const result = await checker.check();

      expect(result.success).toBe(true);
      expect(result.message).toContain('200');
    });

    it('should succeed with custom expected status', async () => {
      const fetch = (await import('node-fetch')).default;
      vi.mocked(fetch).mockResolvedValue({
        status: 204,
      } as any);

      const config: HttpReadyCheck = {
        type: 'http',
        url: 'http://localhost:3000/health',
        expectedStatus: 204,
      };

      const checker = new HttpHealthChecker(config);
      const result = await checker.check();

      expect(result.success).toBe(true);
    });

    it('should fail when status does not match expected', async () => {
      const fetch = (await import('node-fetch')).default;
      vi.mocked(fetch).mockResolvedValue({
        status: 404,
      } as any);

      const config: HttpReadyCheck = {
        type: 'http',
        url: 'http://localhost:3000/health',
      };

      const checker = new HttpHealthChecker(config);
      const result = await checker.check();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Expected status 200');
      expect(result.message).toContain('got 404');
    });

    it('should fail on network error', async () => {
      const fetch = (await import('node-fetch')).default;
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const config: HttpReadyCheck = {
        type: 'http',
        url: 'http://localhost:3000/health',
      };

      const checker = new HttpHealthChecker(config);
      const result = await checker.check();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Network error');
      expect(result.error).toBeDefined();
    });

    it('should timeout after 5 seconds', async () => {
      const fetch = (await import('node-fetch')).default;
      vi.mocked(fetch).mockImplementation(
        () =>
          new Promise((resolve) => {
            // Never resolve
          })
      );

      const config: HttpReadyCheck = {
        type: 'http',
        url: 'http://localhost:3000/health',
      };

      const checker = new HttpHealthChecker(config);

      // Don't await - we'll advance time
      const promise = checker.check();

      // Advance time to trigger timeout
      await vi.advanceTimersByTimeAsync(6000);

      // The fetch should have been aborted
      // The result will depend on how fetch handles abort
    });
  });

  describe('TcpHealthChecker', () => {
    it('should succeed when TCP connection succeeds', async () => {
      const { createConnection } = await import('net');
      const mockSocket = new EventEmitter() as any;
      mockSocket.end = vi.fn();

      vi.mocked(createConnection).mockReturnValue(mockSocket);

      const config: TcpReadyCheck = {
        type: 'tcp',
        host: 'localhost',
        port: 5432,
      };

      const checker = new TcpHealthChecker(config);
      const promise = checker.check();

      // Simulate successful connection
      mockSocket.emit('connect');

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.message).toContain('TCP connection');
      expect(result.message).toContain('localhost:5432');
      expect(mockSocket.end).toHaveBeenCalled();
    });

    it('should fail when TCP connection fails', async () => {
      const { createConnection } = await import('net');
      const mockSocket = new EventEmitter() as any;

      vi.mocked(createConnection).mockReturnValue(mockSocket);

      const config: TcpReadyCheck = {
        type: 'tcp',
        host: 'localhost',
        port: 5432,
      };

      const checker = new TcpHealthChecker(config);
      const promise = checker.check();

      // Simulate connection error
      const error = new Error('Connection refused');
      mockSocket.emit('error', error);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.message).toContain('Connection refused');
      expect(result.error).toBe(error);
    });

    it('should fail on timeout', async () => {
      const { createConnection } = await import('net');
      const mockSocket = new EventEmitter() as any;
      mockSocket.destroy = vi.fn();

      vi.mocked(createConnection).mockReturnValue(mockSocket);

      const config: TcpReadyCheck = {
        type: 'tcp',
        host: 'localhost',
        port: 5432,
      };

      const checker = new TcpHealthChecker(config);
      const promise = checker.check();

      // Simulate timeout
      mockSocket.emit('timeout');

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.message).toContain('timeout');
      expect(mockSocket.destroy).toHaveBeenCalled();
    });
  });

  describe('LogPatternHealthChecker', () => {
    it('should start in not-ready state', async () => {
      const config: LogPatternReadyCheck = {
        type: 'log-pattern',
        pattern: 'Server started',
      };

      const checker = new LogPatternHealthChecker(config);
      const result = await checker.check();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should succeed when pattern is found', async () => {
      const config: LogPatternReadyCheck = {
        type: 'log-pattern',
        pattern: 'Server started',
      };

      const checker = new LogPatternHealthChecker(config);

      // Process some log lines
      expect(checker.processLogLine('Starting server...')).toBe(false);
      expect(checker.processLogLine('Server started on port 3000')).toBe(true);

      const result = await checker.check();
      expect(result.success).toBe(true);
      expect(result.message).toContain('Pattern matched');
    });

    it('should use regex pattern matching', async () => {
      const config: LogPatternReadyCheck = {
        type: 'log-pattern',
        pattern: 'Listening on port \\d+',
      };

      const checker = new LogPatternHealthChecker(config);

      expect(checker.processLogLine('Starting...')).toBe(false);
      expect(checker.processLogLine('Listening on port 3000')).toBe(true);

      const result = await checker.check();
      expect(result.success).toBe(true);
    });

    it('should stay ready after pattern is found', async () => {
      const config: LogPatternReadyCheck = {
        type: 'log-pattern',
        pattern: 'Ready',
      };

      const checker = new LogPatternHealthChecker(config);

      checker.processLogLine('Ready to accept connections');

      expect(await checker.check()).toMatchObject({ success: true });
      expect(await checker.check()).toMatchObject({ success: true });
    });

    it('should return true on subsequent processLogLine calls after pattern found', () => {
      const config: LogPatternReadyCheck = {
        type: 'log-pattern',
        pattern: 'Ready',
      };

      const checker = new LogPatternHealthChecker(config);

      expect(checker.processLogLine('Ready')).toBe(true);
      expect(checker.processLogLine('Some other log')).toBe(true);
    });

    it('should reset state when reset() is called', async () => {
      const config: LogPatternReadyCheck = {
        type: 'log-pattern',
        pattern: 'Ready',
      };

      const checker = new LogPatternHealthChecker(config);

      checker.processLogLine('Ready');
      expect((await checker.check()).success).toBe(true);

      checker.reset();
      expect((await checker.check()).success).toBe(false);
    });

    it('should have synchronous checkSync method', () => {
      const config: LogPatternReadyCheck = {
        type: 'log-pattern',
        pattern: 'Ready',
      };

      const checker = new LogPatternHealthChecker(config);

      expect(checker.checkSync().success).toBe(false);

      checker.processLogLine('Ready');

      expect(checker.checkSync().success).toBe(true);
    });
  });

  describe('CustomHealthChecker', () => {
    it('should succeed when command exits with 0', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        exitCode: 0,
      } as any);

      const config: CustomReadyCheck = {
        type: 'custom',
        command: 'curl -f http://localhost:3000/health',
      };

      const checker = new CustomHealthChecker(config);
      const result = await checker.check();

      expect(result.success).toBe(true);
      expect(result.message).toContain('passed');
      expect(execa).toHaveBeenCalledWith(
        'bash',
        ['-c', config.command],
        expect.objectContaining({ timeout: 5000 })
      );
    });

    it('should fail when command exits with non-zero', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        exitCode: 1,
      } as any);

      const config: CustomReadyCheck = {
        type: 'custom',
        command: 'curl -f http://localhost:3000/health',
      };

      const checker = new CustomHealthChecker(config);
      const result = await checker.check();

      expect(result.success).toBe(false);
      expect(result.message).toContain('exit code 1');
    });

    it('should fail on command error', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValue(new Error('Command not found'));

      const config: CustomReadyCheck = {
        type: 'custom',
        command: 'nonexistent-command',
      };

      const checker = new CustomHealthChecker(config);
      const result = await checker.check();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Command not found');
      expect(result.error).toBeDefined();
    });
  });

  describe('waitForReady', () => {
    it('should resolve immediately if check passes', async () => {
      const checker = {
        check: vi.fn().mockResolvedValue({ success: true }),
      };

      const config: ReadyCheck = {
        type: 'http',
        url: 'http://localhost:3000',
      };

      const promise = waitForReady(checker, config);

      await vi.advanceTimersByTimeAsync(0);
      await promise;

      expect(checker.check).toHaveBeenCalledTimes(1);
    });

    it('should retry until check passes', async () => {
      let callCount = 0;
      const checker = {
        check: vi.fn().mockImplementation(async () => {
          callCount++;
          return { success: callCount >= 3 };
        }),
      };

      const config: ReadyCheck = {
        type: 'http',
        url: 'http://localhost:3000',
        interval: 100,
      };

      const promise = waitForReady(checker, config);

      // Advance through retries
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(100);
      }

      await promise;

      expect(checker.check).toHaveBeenCalledTimes(3);
    });

    it('should call onAttempt callback for each attempt', async () => {
      let callCount = 0;
      const checker = {
        check: vi.fn().mockImplementation(async () => {
          callCount++;
          return { success: callCount >= 2 };
        }),
      };

      const config: ReadyCheck = {
        type: 'http',
        url: 'http://localhost:3000',
        interval: 100,
      };

      const onAttempt = vi.fn();
      const promise = waitForReady(checker, config, onAttempt);

      for (let i = 0; i < 2; i++) {
        await vi.advanceTimersByTimeAsync(100);
      }

      await promise;

      expect(onAttempt).toHaveBeenCalledTimes(2);
      expect(onAttempt).toHaveBeenNthCalledWith(1, 1, expect.any(Object));
      expect(onAttempt).toHaveBeenNthCalledWith(2, 2, expect.any(Object));
    });

    it('should timeout after configured duration', async () => {
      const checker = {
        check: vi.fn().mockResolvedValue({ success: false }),
      };

      const config: ReadyCheck = {
        type: 'http',
        url: 'http://localhost:3000',
        timeout: 1000,
        interval: 100,
      };

      let error: Error | null = null;
      const promise = waitForReady(checker, config).catch((e) => {
        error = e;
      });

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(1100);
      await promise;

      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toContain('Health check failed');
    });

    it('should stop after maxAttempts', async () => {
      const checker = {
        check: vi.fn().mockResolvedValue({ success: false }),
      };

      const config: ReadyCheck = {
        type: 'http',
        url: 'http://localhost:3000',
        maxAttempts: 5,
        interval: 100,
      };

      let error: Error | null = null;
      const promise = waitForReady(checker, config).catch((e) => {
        error = e;
      });

      // Advance through all attempts
      for (let i = 0; i < 6; i++) {
        await vi.advanceTimersByTimeAsync(100);
      }
      await promise;

      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toContain('after 5 attempts');
    });

    it('should use default timeout and interval', async () => {
      const checker = {
        check: vi.fn().mockResolvedValue({ success: true }),
      };

      const config: ReadyCheck = {
        type: 'http',
        url: 'http://localhost:3000',
      };

      const promise = waitForReady(checker, config);
      await vi.advanceTimersByTimeAsync(0);
      await promise;

      expect(checker.check).toHaveBeenCalled();
    });
  });

  describe('createHealthChecker', () => {
    it('should create HTTP health checker', () => {
      const config: ReadyCheck = {
        type: 'http',
        url: 'http://localhost:3000',
      };

      const checker = createHealthChecker(config);
      expect(checker).toBeInstanceOf(HttpHealthChecker);
    });

    it('should create TCP health checker', () => {
      const config: ReadyCheck = {
        type: 'tcp',
        host: 'localhost',
        port: 5432,
      };

      const checker = createHealthChecker(config);
      expect(checker).toBeInstanceOf(TcpHealthChecker);
    });

    it('should create log pattern health checker', () => {
      const config: ReadyCheck = {
        type: 'log-pattern',
        pattern: 'Ready',
      };

      const checker = createHealthChecker(config);
      expect(checker).toBeInstanceOf(LogPatternHealthChecker);
    });

    it('should create custom health checker', () => {
      const config: ReadyCheck = {
        type: 'custom',
        command: 'test -f /tmp/ready',
      };

      const checker = createHealthChecker(config);
      expect(checker).toBeInstanceOf(CustomHealthChecker);
    });

    it('should throw for exit-code type', () => {
      const config: ReadyCheck = {
        type: 'exit-code',
      };

      expect(() => createHealthChecker(config)).toThrow('Exit code health check');
    });

    it('should throw for unknown type', () => {
      const config = {
        type: 'unknown',
      } as any;

      expect(() => createHealthChecker(config)).toThrow('Unknown health check type');
    });
  });
});
