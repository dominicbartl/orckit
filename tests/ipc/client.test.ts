/**
 * IPC Client connection tests
 * Tests the overview client connecting to real IPC server
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IPCServer } from '@/core/ipc/server';
import { connect, type Socket } from 'node:net';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type {
  IPCMessage,
  StatusUpdateMessage,
  CommandMessage,
  CommandResponseMessage,
  LogMessage,
  IPCProcessInfo,
} from '@/types';

describe('IPC Client Connections', () => {
  const testSocketPath = '/tmp/orckit-test-client.sock';
  let server: IPCServer;

  beforeEach(async () => {
    if (existsSync(testSocketPath)) {
      await unlink(testSocketPath);
    }
    server = new IPCServer({ socketPath: testSocketPath });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
    if (existsSync(testSocketPath)) {
      await unlink(testSocketPath);
    }
  });

  describe('connection establishment', () => {
    it('should successfully connect to running server', async () => {
      const client = await createClient(testSocketPath);
      expect(client.readyState).toBe('open');
      client.destroy();
    });

    it('should fail to connect to non-existent socket', async () => {
      await expect(createClient('/tmp/non-existent-socket.sock')).rejects.toThrow();
    });

    it('should receive connection established event', async () => {
      const client = connect(testSocketPath);
      const connected = await new Promise<boolean>((resolve) => {
        client.on('connect', () => resolve(true));
        client.on('error', () => resolve(false));
      });

      expect(connected).toBe(true);
      client.destroy();
    });

    it('should handle server restart gracefully', async () => {
      const client = await createClient(testSocketPath);
      expect(client.readyState).toBe('open');

      // Stop server
      await server.stop();

      // Wait for disconnect
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Client should be disconnected
      expect(['closed', 'closing'].includes(client.readyState)).toBe(true);
    });
  });

  describe('receiving status updates', () => {
    it('should receive and parse status update messages', async () => {
      const client = await createClient(testSocketPath);
      const messages = collectMessages(client);

      const processes: IPCProcessInfo[] = [
        {
          name: 'api-server',
          status: 'running',
          category: 'backend',
          uptime: 10000,
          pid: 12345,
          restartCount: 0,
        },
        {
          name: 'web-ui',
          status: 'building',
          category: 'frontend',
          uptime: 5000,
          restartCount: 1,
          buildInfo: {
            progress: 60,
            errors: 0,
            warnings: 2,
          },
        },
      ];

      server.broadcastStatus(processes);

      await waitFor(() => messages.length > 0, 1000);

      expect(messages.length).toBe(1);
      const msg = messages[0] as StatusUpdateMessage;
      expect(msg.type).toBe('status_update');
      expect(msg.processes).toEqual(processes);

      client.destroy();
    });

    it('should receive multiple status updates in order', async () => {
      const client = await createClient(testSocketPath);
      const messages = collectMessages(client);

      const update1: IPCProcessInfo[] = [{ name: 'p1', status: 'starting', category: 'test', restartCount: 0 }];
      const update2: IPCProcessInfo[] = [{ name: 'p1', status: 'running', category: 'test', restartCount: 0 }];
      const update3: IPCProcessInfo[] = [{ name: 'p1', status: 'failed', category: 'test', restartCount: 1 }];

      server.broadcastStatus(update1);
      server.broadcastStatus(update2);
      server.broadcastStatus(update3);

      await waitFor(() => messages.length >= 3, 1000);

      expect(messages.length).toBeGreaterThanOrEqual(3);
      expect((messages[0] as StatusUpdateMessage).processes[0].status).toBe('starting');
      expect((messages[1] as StatusUpdateMessage).processes[0].status).toBe('running');
      expect((messages[2] as StatusUpdateMessage).processes[0].status).toBe('failed');

      client.destroy();
    });

    it('should handle empty process list', async () => {
      const client = await createClient(testSocketPath);
      const messages = collectMessages(client);

      server.broadcastStatus([]);

      await waitFor(() => messages.length > 0, 1000);

      const msg = messages[0] as StatusUpdateMessage;
      expect(msg.type).toBe('status_update');
      expect(msg.processes).toEqual([]);

      client.destroy();
    });

    it('should receive system metrics with status updates', async () => {
      const client = await createClient(testSocketPath);
      const messages = collectMessages(client);

      const systemMetrics = {
        timestamp: new Date(),
        cpuUsage: 35.2,
        memoryUsage: 1024 * 1024 * 256,
      };

      server.broadcastStatus([], systemMetrics);

      await waitFor(() => messages.length > 0, 1000);

      const msg = messages[0] as StatusUpdateMessage;
      // Date is serialized as string in JSON
      expect(msg.systemMetrics?.cpuUsage).toBe(35.2);
      expect(msg.systemMetrics?.memoryUsage).toBe(268435456);
      expect(msg.systemMetrics?.timestamp).toBeTruthy();

      client.destroy();
    });
  });

  describe('receiving log messages', () => {
    it('should receive log messages', async () => {
      const client = await createClient(testSocketPath);
      const messages = collectMessages(client);

      server.broadcastLog('test-process', 'stdout', 'Application started');
      server.broadcastLog('test-process', 'stderr', 'Warning: deprecated API');

      await waitFor(() => messages.length >= 2, 1000);

      expect(messages.length).toBeGreaterThanOrEqual(2);

      const log1 = messages[0] as LogMessage;
      const log2 = messages[1] as LogMessage;

      expect(log1.type).toBe('log');
      expect(log1.processName).toBe('test-process');
      expect(log1.level).toBe('stdout');
      expect(log1.content).toBe('Application started');

      expect(log2.type).toBe('log');
      expect(log2.level).toBe('stderr');
      expect(log2.content).toBe('Warning: deprecated API');

      client.destroy();
    });

    it('should handle multi-line log content', async () => {
      const client = await createClient(testSocketPath);
      const messages = collectMessages(client);

      const multiLineLog = 'Line 1\nLine 2\nLine 3';
      server.broadcastLog('test', 'stdout', multiLineLog);

      await waitFor(() => messages.length > 0, 1000);

      const log = messages[0] as LogMessage;
      expect(log.content).toBe(multiLineLog);

      client.destroy();
    });
  });

  describe('sending commands', () => {
    it('should send restart command and receive response', async () => {
      const client = await createClient(testSocketPath);
      const messages = collectMessages(client);

      // Setup server to respond to commands
      const netServer = server.getServer();
      netServer?.on('ipc:command', (message: CommandMessage, socket: Socket) => {
        server.sendCommandResponse(socket, true, `Process ${message.processName} restarted`);
      });

      // Send command
      const command: CommandMessage = {
        type: 'command',
        action: 'restart',
        processName: 'web-server',
      };

      sendCommand(client, command);

      await waitFor(() => messages.some((m) => m.type === 'command_response'), 1000);

      const response = messages.find((m) => m.type === 'command_response') as CommandResponseMessage;
      expect(response).toBeTruthy();
      expect(response.success).toBe(true);
      expect(response.message).toBe('Process web-server restarted');

      client.destroy();
    });

    it('should send stop command', async () => {
      const client = await createClient(testSocketPath);
      const receivedCommands: CommandMessage[] = [];

      const netServer = server.getServer();
      netServer?.on('ipc:command', (message: CommandMessage) => {
        receivedCommands.push(message);
      });

      sendCommand(client, {
        type: 'command',
        action: 'stop',
        processName: 'api-server',
      });

      await waitFor(() => receivedCommands.length > 0, 1000);

      expect(receivedCommands[0].action).toBe('stop');
      expect(receivedCommands[0].processName).toBe('api-server');

      client.destroy();
    });

    it('should send start command', async () => {
      const client = await createClient(testSocketPath);
      const receivedCommands: CommandMessage[] = [];

      const netServer = server.getServer();
      netServer?.on('ipc:command', (message: CommandMessage) => {
        receivedCommands.push(message);
      });

      sendCommand(client, {
        type: 'command',
        action: 'start',
        processName: 'worker',
      });

      await waitFor(() => receivedCommands.length > 0, 1000);

      expect(receivedCommands[0].action).toBe('start');
      expect(receivedCommands[0].processName).toBe('worker');

      client.destroy();
    });

    it('should handle command with options', async () => {
      const client = await createClient(testSocketPath);
      const receivedCommands: CommandMessage[] = [];

      const netServer = server.getServer();
      netServer?.on('ipc:command', (message: CommandMessage) => {
        receivedCommands.push(message);
      });

      sendCommand(client, {
        type: 'command',
        action: 'logs',
        processName: 'api',
        options: { follow: true, tail: 100 },
      });

      await waitFor(() => receivedCommands.length > 0, 1000);

      expect(receivedCommands[0].options).toEqual({ follow: true, tail: 100 });

      client.destroy();
    });

    it('should handle command failure response', async () => {
      const client = await createClient(testSocketPath);
      const messages = collectMessages(client);

      const netServer = server.getServer();
      netServer?.on('ipc:command', (message: CommandMessage, socket: Socket) => {
        server.sendCommandResponse(socket, false, 'Process not found', {
          error: 'PROCESS_NOT_FOUND',
        });
      });

      sendCommand(client, {
        type: 'command',
        action: 'restart',
        processName: 'non-existent',
      });

      await waitFor(() => messages.some((m) => m.type === 'command_response'), 1000);

      const response = messages.find((m) => m.type === 'command_response') as CommandResponseMessage;
      expect(response.success).toBe(false);
      expect(response.message).toBe('Process not found');
      expect(response.data).toEqual({ error: 'PROCESS_NOT_FOUND' });

      client.destroy();
    });
  });

  describe('mixed message streams', () => {
    it('should handle interleaved status updates and logs', async () => {
      const client = await createClient(testSocketPath);
      const messages = collectMessages(client);

      server.broadcastStatus([{ name: 'p1', status: 'starting', category: 'test', restartCount: 0 }]);
      server.broadcastLog('p1', 'stdout', 'Starting...');
      server.broadcastStatus([{ name: 'p1', status: 'running', category: 'test', restartCount: 0 }]);
      server.broadcastLog('p1', 'stdout', 'Ready!');

      await waitFor(() => messages.length >= 4, 1000);

      expect(messages[0].type).toBe('status_update');
      expect(messages[1].type).toBe('log');
      expect(messages[2].type).toBe('status_update');
      expect(messages[3].type).toBe('log');

      client.destroy();
    });

    it('should handle commands while receiving broadcasts', async () => {
      const client = await createClient(testSocketPath);
      const messages = collectMessages(client);
      const commands: CommandMessage[] = [];

      const netServer = server.getServer();
      netServer?.on('ipc:command', (message: CommandMessage, socket: Socket) => {
        commands.push(message);
        server.sendCommandResponse(socket, true, 'OK');
      });

      // Interleave broadcasts and commands
      server.broadcastStatus([{ name: 'p1', status: 'running', category: 'test', restartCount: 0 }]);
      sendCommand(client, { type: 'command', action: 'restart', processName: 'p1' });
      server.broadcastLog('p1', 'stdout', 'Restarting...');
      server.broadcastStatus([{ name: 'p1', status: 'starting', category: 'test', restartCount: 1 }]);

      await waitFor(() => messages.length >= 4 && commands.length >= 1, 1000);

      expect(commands.length).toBeGreaterThanOrEqual(1);
      expect(messages.some((m) => m.type === 'status_update')).toBe(true);
      expect(messages.some((m) => m.type === 'log')).toBe(true);
      expect(messages.some((m) => m.type === 'command_response')).toBe(true);

      client.destroy();
    });
  });

  describe('reconnection scenarios', () => {
    it('should detect when server closes connection', async () => {
      const client = await createClient(testSocketPath);

      let closed = false;
      client.on('close', () => {
        closed = true;
      });

      await server.stop();

      await waitFor(() => closed, 1000);

      expect(closed).toBe(true);
    });

    it('should allow reconnection after disconnect', async () => {
      const client1 = await createClient(testSocketPath);
      client1.destroy();

      await new Promise((resolve) => setTimeout(resolve, 100));

      const client2 = await createClient(testSocketPath);
      expect(client2.readyState).toBe('open');
      client2.destroy();
    });
  });

  describe('buffering and message boundaries', () => {
    it('should correctly parse messages received in single chunk', async () => {
      const client = await createClient(testSocketPath);
      const messages = collectMessages(client);

      // Send multiple messages at once
      server.broadcastLog('p1', 'stdout', 'Message 1');
      server.broadcastLog('p2', 'stdout', 'Message 2');
      server.broadcastLog('p3', 'stdout', 'Message 3');

      await waitFor(() => messages.length >= 3, 1000);

      expect(messages.length).toBeGreaterThanOrEqual(3);
      expect((messages[0] as LogMessage).content).toBe('Message 1');
      expect((messages[1] as LogMessage).content).toBe('Message 2');
      expect((messages[2] as LogMessage).content).toBe('Message 3');

      client.destroy();
    });

    it('should handle large messages', async () => {
      const client = await createClient(testSocketPath);
      const messages = collectMessages(client);

      const largeContent = 'x'.repeat(10000);
      server.broadcastLog('test', 'stdout', largeContent);

      await waitFor(() => messages.length > 0, 1000);

      const msg = messages[0] as LogMessage;
      expect(msg.content).toBe(largeContent);
      expect(msg.content.length).toBe(10000);

      client.destroy();
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
    }, 10);
  });
}
