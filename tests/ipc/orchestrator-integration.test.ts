/**
 * Orchestrator IPC Integration tests
 * Tests the full integration between Orchestrator, IPC Server, and StatusMonitor
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Orchestrator } from '@/core/orchestrator';
import { connect, type Socket } from 'node:net';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type {
  OrckitConfig,
  IPCMessage,
  StatusUpdateMessage,
  CommandMessage,
  CommandResponseMessage,
} from '@/types';

describe('Orchestrator IPC Integration', () => {
  const testSocketPath = '/tmp/orckit-test-integration.sock';
  let orchestrator: Orchestrator;

  const createTestConfig = (): OrckitConfig => ({
    version: '1',
    project: 'test-integration',
    processes: {
      'quick-exit': {
        category: 'test',
        type: 'bash',
        command: 'echo "Hello" && sleep 0.5',
        ready: {
          type: 'exit-code',
        },
      },
      'long-running': {
        category: 'test',
        type: 'bash',
        command: 'while true; do echo "tick"; sleep 1; done',
      },
    },
  });

  beforeEach(async () => {
    if (existsSync(testSocketPath)) {
      await unlink(testSocketPath);
    }
  });

  afterEach(async () => {
    if (orchestrator) {
      try {
        await orchestrator.stop();
      } catch {
        // Ignore cleanup errors
      }
    }
    if (existsSync(testSocketPath)) {
      await unlink(testSocketPath);
    }
  });

  describe('IPC server lifecycle', () => {
    it('should start IPC server alongside orchestrator', async () => {
      const config = createTestConfig();
      orchestrator = new Orchestrator({
        config,
        enableTmux: false,
        enableIPC: true,
      });

      // Manually set socket path for testing
      // In real usage, this is determined by project name
      const socketPath = '/tmp/orckit-test-integration.sock';

      // Start processes (which also starts IPC server)
      await orchestrator.start();

      // Give IPC server time to initialize
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Socket should exist
      expect(existsSync(socketPath)).toBe(true);

      // Should be able to connect
      const client = await createClient(socketPath);
      expect(client.readyState).toBe('open');
      client.destroy();
    });

    it('should stop IPC server when orchestrator stops', async () => {
      const config = createTestConfig();
      orchestrator = new Orchestrator({
        config,
        enableTmux: false,
        enableIPC: true,
      });

      await orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const socketPath = '/tmp/orckit-test-integration.sock';
      expect(existsSync(socketPath)).toBe(true);

      await orchestrator.stop();
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Socket should be cleaned up
      expect(existsSync(socketPath)).toBe(false);
    });
  });

  describe('status broadcasting', () => {
    it('should broadcast process status updates to IPC clients', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-integration',
        processes: {
          'test-proc': {
            category: 'test',
            type: 'bash',
            command: 'sleep 2',
          },
        },
      };

      orchestrator = new Orchestrator({
        config,
        enableTmux: false,
        enableIPC: true,
        statusUpdateInterval: 100, // Faster updates for testing
      });

      await orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const client = await createClient('/tmp/orckit-test-integration.sock');
      const messages = collectMessages(client);

      // Wait for status updates
      await waitFor(() => messages.length > 0, 3000);

      expect(messages.length).toBeGreaterThan(0);

      const statusUpdates = messages.filter((m) => m.type === 'status_update') as StatusUpdateMessage[];
      expect(statusUpdates.length).toBeGreaterThan(0);

      // Should have process info
      const hasTestProc = statusUpdates.some((update) =>
        update.processes.some((p) => p.name === 'test-proc')
      );
      expect(hasTestProc).toBe(true);

      client.destroy();
    });

    it('should update process status as it changes', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-integration',
        processes: {
          'quick-task': {
            category: 'test',
            type: 'bash',
            command: 'echo "start" && sleep 1 && echo "done"',
            ready: {
              type: 'exit-code',
            },
          },
        },
      };

      orchestrator = new Orchestrator({
        config,
        enableTmux: false,
        enableIPC: true,
        statusUpdateInterval: 100,
      });

      await orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 300));

      const client = await createClient('/tmp/orckit-test-integration.sock');
      const messages = collectMessages(client);

      // Wait for multiple status updates
      await waitFor(() => messages.length >= 3, 5000);

      const statusUpdates = messages.filter((m) => m.type === 'status_update') as StatusUpdateMessage[];

      // Should see status progression
      const statuses = statusUpdates
        .map((update) => update.processes.find((p) => p.name === 'quick-task')?.status)
        .filter(Boolean);

      // Should have seen multiple different statuses
      const uniqueStatuses = new Set(statuses);
      expect(uniqueStatuses.size).toBeGreaterThan(1);

      client.destroy();
    });

    it('should broadcast to multiple clients simultaneously', async () => {
      const config = createTestConfig();
      orchestrator = new Orchestrator({
        config,
        enableTmux: false,
        enableIPC: true,
        statusUpdateInterval: 100,
      });

      await orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const socketPath = '/tmp/orckit-test-integration.sock';
      const client1 = await createClient(socketPath);
      const client2 = await createClient(socketPath);
      const client3 = await createClient(socketPath);

      const messages1 = collectMessages(client1);
      const messages2 = collectMessages(client2);
      const messages3 = collectMessages(client3);

      // Wait for broadcasts
      await waitFor(() => messages1.length > 0 && messages2.length > 0 && messages3.length > 0, 3000);

      // All clients should receive messages
      expect(messages1.length).toBeGreaterThan(0);
      expect(messages2.length).toBeGreaterThan(0);
      expect(messages3.length).toBeGreaterThan(0);

      client1.destroy();
      client2.destroy();
      client3.destroy();
    });
  });

  describe('command handling', () => {
    it('should handle restart command via IPC', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-integration',
        processes: {
          'restartable': {
            category: 'test',
            type: 'bash',
            command: 'sleep 10',
          },
        },
      };

      orchestrator = new Orchestrator({
        config,
        enableTmux: false,
        enableIPC: true,
      });

      await orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const client = await createClient('/tmp/orckit-test-integration.sock');
      const messages = collectMessages(client);

      // Send restart command
      const command: CommandMessage = {
        type: 'command',
        action: 'restart',
        processName: 'restartable',
      };

      sendCommand(client, command);

      // Wait for response
      await waitFor(() => messages.some((m) => m.type === 'command_response'), 3000);

      const response = messages.find((m) => m.type === 'command_response') as CommandResponseMessage;
      expect(response).toBeTruthy();
      expect(response.success).toBe(true);
      expect(response.message).toContain('restartable');

      client.destroy();
    });

    it('should handle stop command via IPC', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-integration',
        processes: {
          'stoppable': {
            category: 'test',
            type: 'bash',
            command: 'sleep 10',
          },
        },
      };

      orchestrator = new Orchestrator({
        config,
        enableTmux: false,
        enableIPC: true,
      });

      await orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const client = await createClient('/tmp/orckit-test-integration.sock');
      const messages = collectMessages(client);

      // Send stop command
      sendCommand(client, {
        type: 'command',
        action: 'stop',
        processName: 'stoppable',
      });

      // Wait for response
      await waitFor(() => messages.some((m) => m.type === 'command_response'), 3000);

      const response = messages.find((m) => m.type === 'command_response') as CommandResponseMessage;
      expect(response).toBeTruthy();
      expect(response.success).toBe(true);

      // Verify process is actually stopped
      const status = orchestrator.getStatus('stoppable');
      expect(status).toBe('stopped');

      client.destroy();
    });

    it('should handle errors in commands gracefully', async () => {
      const config = createTestConfig();
      orchestrator = new Orchestrator({
        config,
        enableTmux: false,
        enableIPC: true,
      });

      await orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const client = await createClient('/tmp/orckit-test-integration.sock');
      const messages = collectMessages(client);

      // Send command for non-existent process
      sendCommand(client, {
        type: 'command',
        action: 'restart',
        processName: 'non-existent-process',
      });

      // Wait for error response
      await waitFor(() => messages.some((m) => m.type === 'command_response'), 3000);

      const response = messages.find((m) => m.type === 'command_response') as CommandResponseMessage;
      expect(response).toBeTruthy();
      expect(response.success).toBe(false);
      expect(response.message).toBeTruthy();

      client.destroy();
    });

    it('should handle multiple commands in sequence', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-integration',
        processes: {
          'multi-cmd': {
            category: 'test',
            type: 'bash',
            command: 'sleep 10',
          },
        },
      };

      orchestrator = new Orchestrator({
        config,
        enableTmux: false,
        enableIPC: true,
      });

      await orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const client = await createClient('/tmp/orckit-test-integration.sock');
      const messages = collectMessages(client);

      // Send multiple commands
      sendCommand(client, { type: 'command', action: 'stop', processName: 'multi-cmd' });
      sendCommand(client, { type: 'command', action: 'start', processName: 'multi-cmd' });
      sendCommand(client, { type: 'command', action: 'restart', processName: 'multi-cmd' });

      // Wait for all responses
      await waitFor(() => messages.filter((m) => m.type === 'command_response').length >= 3, 5000);

      const responses = messages.filter((m) => m.type === 'command_response') as CommandResponseMessage[];
      expect(responses.length).toBeGreaterThanOrEqual(3);

      client.destroy();
    });
  });

  describe('process lifecycle events', () => {
    it('should broadcast when process starts', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-integration',
        processes: {
          'starter': {
            category: 'test',
            type: 'bash',
            command: 'echo "starting" && sleep 2',
          },
        },
      };

      orchestrator = new Orchestrator({
        config,
        enableTmux: false,
        enableIPC: true,
        statusUpdateInterval: 100,
      });

      const socketPath = '/tmp/orckit-test-integration.sock';

      // Connect client before starting
      // We need to connect after IPC server is initialized, which happens during start()
      // So we'll start orchestrator first, then connect

      const startPromise = orchestrator.start();

      // Wait a bit for IPC server to initialize
      await new Promise((resolve) => setTimeout(resolve, 300));

      const client = await createClient(socketPath);
      const messages = collectMessages(client);

      await startPromise;

      // Should see starting status
      await waitFor(
        () => {
          const statusUpdates = messages.filter((m) => m.type === 'status_update') as StatusUpdateMessage[];
          return statusUpdates.some((update) =>
            update.processes.some((p) => p.name === 'starter' && p.status === 'starting')
          );
        },
        3000
      );

      const statusUpdates = messages.filter((m) => m.type === 'status_update') as StatusUpdateMessage[];
      const hasStarting = statusUpdates.some((update) =>
        update.processes.some((p) => p.name === 'starter' && p.status === 'starting')
      );

      expect(hasStarting).toBe(true);

      client.destroy();
    });

    it('should track restart count', async () => {
      const config: OrckitConfig = {
        version: '1',
        project: 'test-integration',
        processes: {
          'restarter': {
            category: 'test',
            type: 'bash',
            command: 'sleep 5',
          },
        },
      };

      orchestrator = new Orchestrator({
        config,
        enableTmux: false,
        enableIPC: true,
        statusUpdateInterval: 100,
      });

      await orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const client = await createClient('/tmp/orckit-test-integration.sock');
      const messages = collectMessages(client);

      // Get initial restart count
      await waitFor(() => messages.some((m) => m.type === 'status_update'), 2000);
      const initialUpdate = messages.find((m) => m.type === 'status_update') as StatusUpdateMessage;
      const initialCount =
        initialUpdate.processes.find((p) => p.name === 'restarter')?.restartCount ?? 0;

      // Restart process
      sendCommand(client, { type: 'command', action: 'restart', processName: 'restarter' });

      // Wait for restart to complete and status to update
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check restart count increased
      const laterUpdates = messages.filter((m) => m.type === 'status_update') as StatusUpdateMessage[];
      const laterUpdate = laterUpdates[laterUpdates.length - 1];
      const laterCount = laterUpdate.processes.find((p) => p.name === 'restarter')?.restartCount ?? 0;

      expect(laterCount).toBeGreaterThan(initialCount);

      client.destroy();
    });
  });

  describe('error scenarios', () => {
    it('should handle IPC client disconnect during operation', async () => {
      const config = createTestConfig();
      orchestrator = new Orchestrator({
        config,
        enableTmux: false,
        enableIPC: true,
      });

      await orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const client = await createClient('/tmp/orckit-test-integration.sock');

      // Abruptly disconnect
      client.destroy();

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Orchestrator should still be functional
      const status = orchestrator.getStatus();
      expect(status).toBeTruthy();

      // Should be able to connect new client
      const newClient = await createClient('/tmp/orckit-test-integration.sock');
      expect(newClient.readyState).toBe('open');
      newClient.destroy();
    });

    it('should not start IPC server if disabled', async () => {
      const config = createTestConfig();
      orchestrator = new Orchestrator({
        config,
        enableTmux: false,
        enableIPC: false,
      });

      await orchestrator.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Socket should not exist
      expect(existsSync('/tmp/orckit-test-integration.sock')).toBe(false);
    });
  });
});

// Helper functions

function createClient(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const client = connect(socketPath);
    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('Connection timeout'));
    }, 5000);

    client.on('connect', () => {
      clearTimeout(timeout);
      resolve(client);
    });

    client.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function collectMessages(client: Socket): IPCMessage[] {
  const messages: IPCMessage[] = [];
  let buffer = '';

  client.on('data', (data) => {
    buffer += data.toString();

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (line.trim()) {
        try {
          messages.push(JSON.parse(line));
        } catch (error) {
          console.error('Failed to parse message:', line);
        }
      }
    }
  });

  return messages;
}

function sendCommand(client: Socket, command: CommandMessage): void {
  client.write(JSON.stringify(command) + '\n');
}

function waitFor(condition: () => boolean, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        reject(new Error('Timeout waiting for condition'));
      }
    }, 50);
  });
}
