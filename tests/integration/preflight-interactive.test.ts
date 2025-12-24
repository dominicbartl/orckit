/**
 * Integration tests for interactive preflight checks
 * Tests port conflict resolution and Docker daemon prompts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handlePortConflicts, handleDockerNotRunning } from '../../src/core/preflight/interactive.js';
import type { PortCheckResult } from '../../src/utils/port.js';
import prompts from 'prompts';

// Mock the prompts module
vi.mock('prompts');

describe('Interactive Preflight Checks', () => {
  const mockPrompts = vi.mocked(prompts);

  beforeEach(() => {
    mockPrompts.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('handlePortConflicts', () => {
    it('should return false when user cancels prompt', async () => {
      const conflicts: PortCheckResult[] = [
        {
          port: 3000,
          inUse: true,
          user: {
            pid: 12345,
            processName: 'node',
            command: 'node server.js',
            user: 'testuser',
          },
        },
      ];

      // Mock user pressing Ctrl+C (undefined response)
      mockPrompts.mockResolvedValue({ killProcesses: undefined });

      const result = await handlePortConflicts(conflicts);

      expect(result).toBe(false);
    });

    it('should return false when user chooses not to kill processes', async () => {
      const conflicts: PortCheckResult[] = [
        {
          port: 3000,
          inUse: true,
          user: {
            pid: 12345,
            processName: 'node',
            command: 'node server.js',
            user: 'testuser',
          },
        },
      ];

      // Mock user choosing "No"
      mockPrompts.mockResolvedValue({ killProcesses: false });

      const result = await handlePortConflicts(conflicts);

      expect(result).toBe(false);
    });

    it('should display all conflict details', async () => {
      const conflicts: PortCheckResult[] = [
        {
          port: 3000,
          inUse: true,
          user: {
            pid: 12345,
            processName: 'node',
            command: 'node server.js',
            user: 'testuser',
          },
        },
        {
          port: 5432,
          inUse: true,
          user: {
            pid: 67890,
            processName: 'postgres',
            command: 'postgres -D /usr/local/var/postgres',
            user: 'postgres',
          },
        },
      ];

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockPrompts.mockResolvedValue({ killProcesses: false });

      await handlePortConflicts(conflicts);

      // Verify all conflict details were displayed
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Port conflicts detected'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Port 3000'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Port 5432'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('12345'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('67890'));

      consoleSpy.mockRestore();
    });

    it('should handle conflicts with unknown processes', async () => {
      const conflicts: PortCheckResult[] = [
        {
          port: 8080,
          inUse: true,
          user: undefined,
        },
      ];

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockPrompts.mockResolvedValue({ killProcesses: false });

      await handlePortConflicts(conflicts);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown process'));

      consoleSpy.mockRestore();
    });

    it('should truncate long commands', async () => {
      const longCommand = 'a'.repeat(100);
      const conflicts: PortCheckResult[] = [
        {
          port: 3000,
          inUse: true,
          user: {
            pid: 12345,
            processName: 'node',
            command: longCommand,
            user: 'testuser',
          },
        },
      ];

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockPrompts.mockResolvedValue({ killProcesses: false });

      await handlePortConflicts(conflicts);

      // Should truncate to 80 chars (77 + '...')
      const commandCalls = consoleSpy.mock.calls.filter((call) =>
        String(call[0]).includes('Command:')
      );
      expect(commandCalls.length).toBeGreaterThan(0);
      const commandOutput = String(commandCalls[0][0]);
      expect(commandOutput).toContain('...');

      consoleSpy.mockRestore();
    });
  });

  describe('handleDockerNotRunning', () => {
    it('should return false when user cancels prompt', async () => {
      // Mock user pressing Ctrl+C
      mockPrompts.mockResolvedValue({ retry: undefined });

      const result = await handleDockerNotRunning();

      expect(result).toBe(false);
    });

    it('should return false when user chooses not to continue', async () => {
      // Mock user choosing "No"
      mockPrompts.mockResolvedValue({ retry: false });

      const result = await handleDockerNotRunning();

      expect(result).toBe(false);
    });

    it('should display Docker not running message', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockPrompts.mockResolvedValue({ retry: false });

      await handleDockerNotRunning();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Docker daemon is not running'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Docker Desktop'));

      consoleSpy.mockRestore();
    });
  });
});
