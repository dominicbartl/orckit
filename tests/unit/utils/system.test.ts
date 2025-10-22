import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import {
  commandExists,
  isPortAvailable,
  checkPortsAvailability,
  getNodeVersion,
  isDockerRunning,
  isTmuxAvailable,
  getTmuxVersion,
  killProcessTree,
  waitFor,
  sleep,
  getProcessEnv,
} from '../../../src/utils/system.js';

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock net
vi.mock('net', () => ({
  createServer: vi.fn(),
}));

// Mock tree-kill
vi.mock('tree-kill', () => ({
  default: vi.fn(),
}));

describe('System Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('commandExists', () => {
    it('should return true when command exists', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        stdout: '/usr/bin/node',
      } as any);

      const result = await commandExists('node');
      expect(result).toBe(true);
      expect(execa).toHaveBeenCalledWith('which', ['node']);
    });

    it('should return false when command does not exist', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValue(new Error('Command not found'));

      const result = await commandExists('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('isPortAvailable', () => {
    it('should return true when port is available', async () => {
      const { createServer } = await import('net');
      const mockServer = new EventEmitter() as any;
      mockServer.listen = vi.fn((port, host) => {
        // Simulate successful listening
        setImmediate(() => mockServer.emit('listening'));
      });
      mockServer.close = vi.fn();

      vi.mocked(createServer).mockReturnValue(mockServer);

      const result = await isPortAvailable(3000);
      expect(result).toBe(true);
      expect(mockServer.close).toHaveBeenCalled();
    });

    it('should return false when port is in use', async () => {
      const { createServer } = await import('net');
      const mockServer = new EventEmitter() as any;
      mockServer.listen = vi.fn((port, host) => {
        // Simulate port in use error
        setImmediate(() => mockServer.emit('error', new Error('EADDRINUSE')));
      });

      vi.mocked(createServer).mockReturnValue(mockServer);

      const result = await isPortAvailable(3000);
      expect(result).toBe(false);
    });

    it('should use custom host', async () => {
      const { createServer } = await import('net');
      const mockServer = new EventEmitter() as any;
      mockServer.listen = vi.fn((port, host) => {
        expect(port).toBe(8080);
        expect(host).toBe('0.0.0.0');
        setImmediate(() => mockServer.emit('listening'));
      });
      mockServer.close = vi.fn();

      vi.mocked(createServer).mockReturnValue(mockServer);

      await isPortAvailable(8080, '0.0.0.0');
    });
  });

  describe('checkPortsAvailability', () => {
    it('should check multiple ports', async () => {
      const { createServer } = await import('net');
      let callCount = 0;

      vi.mocked(createServer).mockImplementation(() => {
        const mockServer = new EventEmitter() as any;
        const index = callCount++;

        mockServer.listen = vi.fn(() => {
          // First port available, second not
          setImmediate(() => {
            if (index === 0) {
              mockServer.emit('listening');
            } else {
              mockServer.emit('error', new Error('EADDRINUSE'));
            }
          });
        });
        mockServer.close = vi.fn();

        return mockServer;
      });

      const result = await checkPortsAvailability([3000, 3001]);
      expect(result).toEqual({
        3000: true,
        3001: false,
      });
    });

    it('should handle empty array', async () => {
      const result = await checkPortsAvailability([]);
      expect(result).toEqual({});
    });
  });

  describe('getNodeVersion', () => {
    it('should parse Node.js version correctly', () => {
      // Save original version
      const originalVersion = process.version;

      // Mock process.version
      Object.defineProperty(process, 'version', {
        value: 'v18.17.1',
        writable: true,
        configurable: true,
      });

      const version = getNodeVersion();
      expect(version).toEqual({
        major: 18,
        minor: 17,
        patch: 1,
      });

      // Restore original version
      Object.defineProperty(process, 'version', {
        value: originalVersion,
        writable: true,
        configurable: true,
      });
    });
  });

  describe('isDockerRunning', () => {
    it('should return true when Docker is running', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        stdout: 'Docker info output',
      } as any);

      const result = await isDockerRunning();
      expect(result).toBe(true);
      expect(execa).toHaveBeenCalledWith('docker', ['info'], { timeout: 5000 });
    });

    it('should return false when Docker is not running', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValue(new Error('Docker not running'));

      const result = await isDockerRunning();
      expect(result).toBe(false);
    });

    it('should return false on timeout', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValue(new Error('Timeout'));

      const result = await isDockerRunning();
      expect(result).toBe(false);
    });
  });

  describe('isTmuxAvailable', () => {
    it('should return true when tmux is available', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        stdout: '/usr/bin/tmux',
      } as any);

      const result = await isTmuxAvailable();
      expect(result).toBe(true);
    });

    it('should return false when tmux is not available', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValue(new Error('Command not found'));

      const result = await isTmuxAvailable();
      expect(result).toBe(false);
    });
  });

  describe('getTmuxVersion', () => {
    it('should return tmux version when available', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockResolvedValue({
        stdout: 'tmux 3.3a',
      } as any);

      const version = await getTmuxVersion();
      expect(version).toBe('tmux 3.3a');
      expect(execa).toHaveBeenCalledWith('tmux', ['-V']);
    });

    it('should return null when tmux is not available', async () => {
      const { execa } = await import('execa');
      vi.mocked(execa).mockRejectedValue(new Error('Command not found'));

      const version = await getTmuxVersion();
      expect(version).toBeNull();
    });
  });

  describe('killProcessTree', () => {
    it('should kill process tree successfully', async () => {
      const treeKillMock = vi.fn((pid, signal, callback) => {
        callback(null);
      });

      vi.doMock('tree-kill', () => ({
        default: treeKillMock,
      }));

      await killProcessTree(12345, 'SIGTERM');

      // Wait a bit for dynamic import
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should use default SIGTERM signal', async () => {
      const treeKillMock = vi.fn((pid, signal, callback) => {
        expect(signal).toBe('SIGTERM');
        callback(null);
      });

      vi.doMock('tree-kill', () => ({
        default: treeKillMock,
      }));

      await killProcessTree(12345);

      // Wait a bit for dynamic import
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should handle custom signals', async () => {
      const treeKillMock = vi.fn((pid, signal, callback) => {
        expect(signal).toBe('SIGKILL');
        callback(null);
      });

      vi.doMock('tree-kill', () => ({
        default: treeKillMock,
      }));

      await killProcessTree(12345, 'SIGKILL');

      // Wait a bit for dynamic import
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  });

  describe('waitFor', () => {
    it('should resolve when condition becomes true', async () => {
      let count = 0;
      const condition = () => {
        count++;
        return count >= 3;
      };

      await waitFor(condition, 1000, 10);
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('should resolve immediately if condition is already true', async () => {
      const condition = () => true;
      const start = Date.now();

      await waitFor(condition, 1000, 10);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });

    it('should timeout if condition never becomes true', async () => {
      const condition = () => false;

      await expect(waitFor(condition, 100, 10)).rejects.toThrow(
        'Condition not met within 100ms'
      );
    });

    it('should work with async conditions', async () => {
      let count = 0;
      const condition = async () => {
        count++;
        return count >= 2;
      };

      await waitFor(condition, 1000, 10);
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it('should use default timeout and interval', async () => {
      const condition = () => true;
      await waitFor(condition);
    });
  });

  describe('sleep', () => {
    it('should sleep for specified duration', async () => {
      const start = Date.now();
      await sleep(50);
      const duration = Date.now() - start;

      expect(duration).toBeGreaterThanOrEqual(45);
      expect(duration).toBeLessThan(100);
    });

    it('should resolve immediately for 0ms', async () => {
      const start = Date.now();
      await sleep(0);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(10);
    });
  });

  describe('getProcessEnv', () => {
    it('should merge process env with custom env', () => {
      const customEnv = {
        CUSTOM_VAR: 'value',
        PATH: '/custom/path',
      };

      const result = getProcessEnv(customEnv);

      expect(result.CUSTOM_VAR).toBe('value');
      expect(result.PATH).toBe('/custom/path');
      // Should include system env vars
      expect(result.HOME).toBeDefined();
    });

    it('should return system env when no custom env provided', () => {
      const result = getProcessEnv();

      expect(result.HOME).toBeDefined();
      expect(result.PATH).toBeDefined();
    });

    it('should handle empty custom env', () => {
      const result = getProcessEnv({});

      expect(result.HOME).toBeDefined();
    });

    it('should override system env vars with custom ones', () => {
      const originalPath = process.env.PATH;
      const customEnv = { PATH: '/my/custom/path' };

      const result = getProcessEnv(customEnv);

      expect(result.PATH).toBe('/my/custom/path');
      expect(result.PATH).not.toBe(originalPath);
    });
  });
});
