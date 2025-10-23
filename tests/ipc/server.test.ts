/**
 * IPC Server integration tests
 * Tests real Unix socket communication without mocks
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

describe('IPCServer', () => {
  const testSocketPath = '/tmp/orckit-test-server.sock';
  let server: IPCServer;

  beforeEach(async () => {
    // Clean up any existing socket
    if (existsSync(testSocketPath)) {
      await unlink(testSocketPath);
    }
    server = new IPCServer({ socketPath: testSocketPath });
  });

  afterEach(async () => {
    await server.stop();
    // Clean up socket file
    if (existsSync(testSocketPath)) {
      await unlink(testSocketPath);
    }
  });

  describe('server lifecycle', () => {
    it('should start and create socket file', async () => {
      await server.start();
      expect(existsSync(testSocketPath)).toBe(true);
    });

    it('should stop and clean up socket file', async () => {
      await server.start();
      expect(existsSync(testSocketPath)).toBe(true);

      await server.stop();
      expect(existsSync(testSocketPath)).toBe(false);
    });

    it('should remove existing socket on start', async () => {
      await server.start();
      await server.stop();

      // Socket file might still exist momentarily
      const newServer = new IPCServer({ socketPath: testSocketPath });
      await newServer.start();
      expect(existsSync(testSocketPath)).toBe(true);

      await newServer.stop();
    });

    it('should accept client connections', async () => {
      await server.start();

      const client = await connectClient(testSocketPath);
      expect(client.readyState).toBe('open');

      client.destroy();
    });

    it('should handle multiple concurrent clients', async () => {
      await server.start();

      const client1 = await connectClient(testSocketPath);
      const client2 = await connectClient(testSocketPath);
      const client3 = await connectClient(testSocketPath);

      expect(server.getClientCount()).toBe(3);

      client1.destroy();
      client2.destroy();
      client3.destroy();

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(server.getClientCount()).toBe(0);
    });
  });

  describe('message broadcasting', () => {
    it('should broadcast status updates to all clients', async () => {
      await server.start();

      const messages1: IPCMessage[] = [];
      const messages2: IPCMessage[] = [];

      const client1 = await connectClient(testSocketPath);
      const client2 = await connectClient(testSocketPath);

      client1.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l) => l);
        lines.forEach((line) => messages1.push(JSON.parse(line)));
      });

      client2.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l) => l);
        lines.forEach((line) => messages2.push(JSON.parse(line)));
      });

      // Broadcast status
      const processes: IPCProcessInfo[] = [
        {
          name: 'test-process',
          status: 'running',
          category: 'services',
          uptime: 5000,
          pid: 12345,
          restartCount: 0,
        },
      ];

      server.broadcastStatus(processes);

      // Wait for messages to arrive
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(messages1.length).toBe(1);
      expect(messages2.length).toBe(1);

      const msg1 = messages1[0] as StatusUpdateMessage;
      const msg2 = messages2[0] as StatusUpdateMessage;

      expect(msg1.type).toBe('status_update');
      expect(msg1.processes).toEqual(processes);
      expect(msg2.type).toBe('status_update');
      expect(msg2.processes).toEqual(processes);

      client1.destroy();
      client2.destroy();
    });

    it('should broadcast log messages', async () => {
      await server.start();

      const messages: IPCMessage[] = [];
      const client = await connectClient(testSocketPath);

      client.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l) => l);
        lines.forEach((line) => messages.push(JSON.parse(line)));
      });

      server.broadcastLog('test-process', 'stdout', 'Hello from process');
      server.broadcastLog('test-process', 'stderr', 'Error message');

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(messages.length).toBe(2);

      const log1 = messages[0] as LogMessage;
      const log2 = messages[1] as LogMessage;

      expect(log1.type).toBe('log');
      expect(log1.processName).toBe('test-process');
      expect(log1.level).toBe('stdout');
      expect(log1.content).toBe('Hello from process');

      expect(log2.type).toBe('log');
      expect(log2.level).toBe('stderr');
      expect(log2.content).toBe('Error message');

      client.destroy();
    });

    it('should handle system metrics in status updates', async () => {
      await server.start();

      const messages: IPCMessage[] = [];
      const client = await connectClient(testSocketPath);

      client.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l) => l);
        lines.forEach((line) => messages.push(JSON.parse(line)));
      });

      const processes: IPCProcessInfo[] = [
        {
          name: 'test',
          status: 'running',
          category: 'test',
          restartCount: 0,
        },
      ];

      const systemMetrics = {
        timestamp: new Date(),
        cpuUsage: 45.5,
        memoryUsage: 1024 * 1024 * 512, // 512 MB
      };

      server.broadcastStatus(processes, systemMetrics);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const msg = messages[0] as StatusUpdateMessage;
      // Date is serialized as string in JSON
      expect(msg.systemMetrics?.cpuUsage).toBe(45.5);
      expect(msg.systemMetrics?.memoryUsage).toBe(536870912);
      expect(msg.systemMetrics?.timestamp).toBeTruthy();

      client.destroy();
    });
  });

  describe('command handling', () => {
    it('should emit command events when receiving commands', async () => {
      await server.start();

      const client = await connectClient(testSocketPath);
      const netServer = server.getServer();

      let receivedCommand: CommandMessage | null = null;
      let receivedSocket: Socket | null = null;

      netServer?.on('ipc:command', (message: CommandMessage, socket: Socket) => {
        receivedCommand = message;
        receivedSocket = socket;
      });

      // Send command
      const command: CommandMessage = {
        type: 'command',
        action: 'restart',
        processName: 'test-process',
      };

      client.write(JSON.stringify(command) + '\n');

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(receivedCommand).toBeTruthy();
      expect(receivedCommand?.type).toBe('command');
      expect(receivedCommand?.action).toBe('restart');
      expect(receivedCommand?.processName).toBe('test-process');
      expect(receivedSocket).toBeTruthy();

      client.destroy();
    });

    it('should send command responses to specific clients', async () => {
      await server.start();

      const client = await connectClient(testSocketPath);
      const netServer = server.getServer();

      const responses: CommandResponseMessage[] = [];

      client.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l) => l);
        lines.forEach((line) => {
          const msg = JSON.parse(line);
          if (msg.type === 'command_response') {
            responses.push(msg);
          }
        });
      });

      netServer?.on('ipc:command', (message: CommandMessage, socket: Socket) => {
        // Simulate command handling
        server.sendCommandResponse(socket, true, `Process ${message.processName} restarted`, {
          processName: message.processName,
        });
      });

      // Send command
      const command: CommandMessage = {
        type: 'command',
        action: 'restart',
        processName: 'test-process',
      };

      client.write(JSON.stringify(command) + '\n');

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(responses.length).toBe(1);
      expect(responses[0].success).toBe(true);
      expect(responses[0].message).toBe('Process test-process restarted');
      expect(responses[0].data).toEqual({ processName: 'test-process' });

      client.destroy();
    });

    it('should handle multiple commands from same client', async () => {
      await server.start();

      const client = await connectClient(testSocketPath);
      const netServer = server.getServer();

      const commands: CommandMessage[] = [];

      netServer?.on('ipc:command', (message: CommandMessage) => {
        commands.push(message);
      });

      // Send multiple commands
      client.write(JSON.stringify({ type: 'command', action: 'restart', processName: 'proc1' }) + '\n');
      client.write(JSON.stringify({ type: 'command', action: 'stop', processName: 'proc2' }) + '\n');
      client.write(JSON.stringify({ type: 'command', action: 'start', processName: 'proc3' }) + '\n');

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(commands.length).toBe(3);
      expect(commands[0].action).toBe('restart');
      expect(commands[1].action).toBe('stop');
      expect(commands[2].action).toBe('start');

      client.destroy();
    });
  });

  describe('error handling', () => {
    it('should handle malformed JSON gracefully', async () => {
      await server.start();

      const client = await connectClient(testSocketPath);

      // Send invalid JSON
      client.write('this is not json\n');
      client.write('{"incomplete": \n');
      client.write('{"valid": "json"}\n'); // This should still work

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Server should still be running
      expect(server.getClientCount()).toBe(1);

      client.destroy();
    });

    it('should handle client disconnections gracefully', async () => {
      await server.start();

      const client1 = await connectClient(testSocketPath);
      const client2 = await connectClient(testSocketPath);

      expect(server.getClientCount()).toBe(2);

      client1.destroy();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(server.getClientCount()).toBe(1);

      client2.destroy();
    });

    it('should handle rapid connect/disconnect cycles', async () => {
      await server.start();

      for (let i = 0; i < 10; i++) {
        const client = await connectClient(testSocketPath);
        client.destroy();
      }

      await new Promise((resolve) => setTimeout(resolve, 200));

      // All clients should be cleaned up
      expect(server.getClientCount()).toBe(0);
    });

    it('should handle clients that write partial messages', async () => {
      await server.start();

      const client = await connectClient(testSocketPath);
      const netServer = server.getServer();

      const commands: CommandMessage[] = [];

      netServer?.on('ipc:command', (message: CommandMessage) => {
        commands.push(message);
      });

      // Send message in chunks (without newline initially)
      const msg = JSON.stringify({ type: 'command', action: 'restart', processName: 'test' });
      const mid = Math.floor(msg.length / 2);

      client.write(msg.slice(0, mid));
      await new Promise((resolve) => setTimeout(resolve, 50));

      // No command should be processed yet
      expect(commands.length).toBe(0);

      // Complete the message
      client.write(msg.slice(mid) + '\n');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Now command should be processed
      expect(commands.length).toBe(1);
      expect(commands[0].action).toBe('restart');

      client.destroy();
    });
  });

  describe('client tracking', () => {
    it('should track client count accurately', async () => {
      await server.start();

      expect(server.getClientCount()).toBe(0);

      const client1 = await connectClient(testSocketPath);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.getClientCount()).toBe(1);

      const client2 = await connectClient(testSocketPath);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.getClientCount()).toBe(2);

      client1.destroy();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.getClientCount()).toBe(1);

      client2.destroy();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(server.getClientCount()).toBe(0);
    });

    it('should clean up all clients on server stop', async () => {
      await server.start();

      const client1 = await connectClient(testSocketPath);
      const client2 = await connectClient(testSocketPath);
      const client3 = await connectClient(testSocketPath);

      expect(server.getClientCount()).toBe(3);

      await server.stop();

      expect(server.getClientCount()).toBe(0);
    });
  });

  describe('message formats', () => {
    it('should include timestamp in status updates', async () => {
      await server.start();

      const messages: StatusUpdateMessage[] = [];
      const client = await connectClient(testSocketPath);

      client.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l) => l);
        lines.forEach((line) => messages.push(JSON.parse(line)));
      });

      const before = Date.now();
      server.broadcastStatus([]);
      const after = Date.now();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(messages.length).toBe(1);
      const timestamp = new Date(messages[0].timestamp).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);

      client.destroy();
    });

    it('should include timestamp in log messages', async () => {
      await server.start();

      const messages: LogMessage[] = [];
      const client = await connectClient(testSocketPath);

      client.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l) => l);
        lines.forEach((line) => messages.push(JSON.parse(line)));
      });

      const before = Date.now();
      server.broadcastLog('test', 'stdout', 'message');
      const after = Date.now();

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(messages.length).toBe(1);
      const timestamp = new Date(messages[0].timestamp).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);

      client.destroy();
    });

    it('should properly serialize process info with all fields', async () => {
      await server.start();

      const messages: StatusUpdateMessage[] = [];
      const client = await connectClient(testSocketPath);

      client.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l) => l);
        lines.forEach((line) => messages.push(JSON.parse(line)));
      });

      const processInfo: IPCProcessInfo = {
        name: 'web-server',
        status: 'building',
        category: 'services',
        uptime: 12345,
        pid: 99999,
        restartCount: 3,
        buildInfo: {
          progress: 75,
          duration: 5000,
          errors: 2,
          warnings: 5,
          modules: { current: 45, total: 60 },
          chunks: 8,
          size: '2.5 MB',
          sizeDiff: '+150 KB',
          lastBuildSuccess: false,
          hash: 'abc123',
        },
      };

      server.broadcastStatus([processInfo]);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(messages.length).toBe(1);
      expect(messages[0].processes[0]).toEqual(processInfo);

      client.destroy();
    });
  });
});

/**
 * Helper function to connect a client to the socket
 */
function connectClient(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const client = connect(socketPath);

    client.on('connect', () => {
      resolve(client);
    });

    client.on('error', (error) => {
      reject(error);
    });
  });
}
