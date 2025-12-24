/**
 * Orckit IPC Integration tests
 * Tests the full integration between Orckit, IPC Server, and StatusMonitor
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Orckit } from '@/core/orckit';
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

describe('Orckit IPC Integration', () => {
  const testSocketPath = '/tmp/orckit-test-integration.sock';
  let orckit: Orckit;

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
    if (orckit) {
      try {
        await orckit.stop();
      } catch {
        // Ignore cleanup errors
      }
    }
    if (existsSync(testSocketPath)) {
      await unlink(testSocketPath);
    }
  });

  describe('IPC server lifecycle', () => {
    it('should start IPC server alongside orckit', async () => {
      const config = createTestConfig();
      orckit = new Orckit({
        config,
        enableIPC: true,
        skipPreflight: true,
      });

      const socketPath = '/tmp/orckit-test-integration.sock';

      await orckit.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(existsSync(socketPath)).toBe(true);

      const client = await createClient(socketPath);
      expect(client.readyState).toBe('open');
      client.destroy();
    });

    it('should stop IPC server when orckit stops', async () => {
      const config = createTestConfig();
      orckit = new Orckit({
        config,
        enableIPC: true,
        skipPreflight: true,
      });

      await orckit.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const socketPath = '/tmp/orckit-test-integration.sock';
      expect(existsSync(socketPath)).toBe(true);

      await orckit.stop();
      await new Promise((resolve) => setTimeout(resolve, 500));

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

      orckit = new Orckit({
        config,
        enableIPC: true,
        statusUpdateInterval: 100,
        skipPreflight: true,
      });

      await orckit.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const client = await createClient('/tmp/orckit-test-integration.sock');
      const messages = collectMessages(client);

      await waitFor(() => messages.length > 0, 3000);

      expect(messages.length).toBeGreaterThan(0);

      const statusUpdates = messages.filter((m) => m.type === 'status_update') as StatusUpdateMessage[];
      expect(statusUpdates.length).toBeGreaterThan(0);

      const hasTestProc = statusUpdates.some((update) =>
        update.processes.some((p) => p.name === 'test-proc')
      );
      expect(hasTestProc).toBe(true);

      client.destroy();
    });

    it('should broadcast to multiple clients simultaneously', async () => {
      const config = createTestConfig();
      orckit = new Orckit({
        config,
        enableIPC: true,
        statusUpdateInterval: 100,
        skipPreflight: true,
      });

      await orckit.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const socketPath = '/tmp/orckit-test-integration.sock';
      const client1 = await createClient(socketPath);
      const client2 = await createClient(socketPath);
      const client3 = await createClient(socketPath);

      const messages1 = collectMessages(client1);
      const messages2 = collectMessages(client2);
      const messages3 = collectMessages(client3);

      await waitFor(() => messages1.length > 0 && messages2.length > 0 && messages3.length > 0, 3000);

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

      orckit = new Orckit({
        config,
        enableIPC: true,
        skipPreflight: true,
      });

      await orckit.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const client = await createClient('/tmp/orckit-test-integration.sock');
      const messages = collectMessages(client);

      const command: CommandMessage = {
        type: 'command',
        action: 'restart',
        processName: 'restartable',
      };

      sendCommand(client, command);

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

      orckit = new Orckit({
        config,
        enableIPC: true,
        skipPreflight: true,
      });

      await orckit.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify process is running before stopping
      const initialStatus = orckit.getStatus('stoppable');
      expect(['starting', 'running']).toContain(initialStatus);

      const client = await createClient('/tmp/orckit-test-integration.sock');
      const messages = collectMessages(client);

      sendCommand(client, {
        type: 'command',
        action: 'stop',
        processName: 'stoppable',
      });

      await waitFor(() => messages.some((m) => m.type === 'command_response'), 3000);

      const response = messages.find((m) => m.type === 'command_response') as CommandResponseMessage;
      expect(response).toBeTruthy();
      expect(response.success).toBe(true);

      // Wait for status to update after stop command
      await waitFor(() => orckit.getStatus('stoppable') === 'stopped', 3000);

      const status = orckit.getStatus('stoppable');
      expect(status).toBe('stopped');

      client.destroy();
    });

    it('should handle errors in commands gracefully', async () => {
      const config = createTestConfig();
      orckit = new Orckit({
        config,
        enableIPC: true,
        skipPreflight: true,
      });

      await orckit.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const client = await createClient('/tmp/orckit-test-integration.sock');
      const messages = collectMessages(client);

      sendCommand(client, {
        type: 'command',
        action: 'restart',
        processName: 'non-existent-process',
      });

      await waitFor(() => messages.some((m) => m.type === 'command_response'), 3000);

      const response = messages.find((m) => m.type === 'command_response') as CommandResponseMessage;
      expect(response).toBeTruthy();
      expect(response.success).toBe(false);
      expect(response.message).toBeTruthy();

      client.destroy();
    });
  });

  describe('error scenarios', () => {
    it('should handle IPC client disconnect during operation', async () => {
      const config = createTestConfig();
      orckit = new Orckit({
        config,
        enableIPC: true,
        skipPreflight: true,
      });

      await orckit.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

      const client = await createClient('/tmp/orckit-test-integration.sock');
      client.destroy();

      await new Promise((resolve) => setTimeout(resolve, 500));

      const status = orckit.getStatus();
      expect(status).toBeTruthy();

      const newClient = await createClient('/tmp/orckit-test-integration.sock');
      expect(newClient.readyState).toBe('open');
      newClient.destroy();
    });

    it('should not start IPC server if disabled', async () => {
      const config = createTestConfig();
      orckit = new Orckit({
        config,
        enableIPC: false,
        skipPreflight: true,
      });

      await orckit.start();
      await new Promise((resolve) => setTimeout(resolve, 500));

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
